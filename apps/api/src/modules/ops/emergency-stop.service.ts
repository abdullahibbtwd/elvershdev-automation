import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AutomationRunMode,
  GenerationJobType,
  JobStatus,
  Prisma,
  PublishStatus,
  VideoRenderStatus,
} from '@prisma/client';
import { ALL_QUEUE_NAMES, QUEUE_NAMES, type QueueName } from '@ai-video/shared';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { KlingProvider } from '../../integrations/providers/kling.provider';

export const EMERGENCY_STOP_SETTING_KEY = 'system:automation:emergencyStop';
export const FFMPEG_KILL_CHANNEL = 'ops:ffmpeg-kill';

export type InterruptOutcome =
  | 'cancelled'
  | 'interrupt_signaled'
  | 'provider_cancel_unsupported'
  | 'provider_cancelled'
  | 'ffmpeg_kill_signaled';

@Injectable()
export class EmergencyStopService {
  private readonly logger = new Logger(EmergencyStopService.name);
  private publisher: IORedis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    private readonly kling: KlingProvider,
  ) {}

  async isActive(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({
      where: { key: EMERGENCY_STOP_SETTING_KEY },
    });
    return (
      !!row &&
      typeof row.value === 'object' &&
      row.value !== null &&
      (row.value as { active?: boolean }).active === true
    );
  }

  async assertNotStopped(): Promise<void> {
    if (await this.isActive()) {
      throw new Error('Global emergency stop is active — new generation/publishing is blocked');
    }
  }

  /**
   * Global emergency stop:
   * 1. Persist flag (blocks new work)
   * 2. Force all automation configs into EMERGENCY_STOP
   * 3. Pause generation/publish queues
   * 4. Cancel cancellable waiting/delayed jobs
   * 5. Mark running work INTERRUPTED (honest — may still run externally)
   * 6. Attempt provider cancel where supported; otherwise reconcile
   * 7. Signal worker to SIGKILL local FFmpeg children
   * 8. Block republish of interrupted publications
   */
  async activate(reason = 'ops.emergency_stop'): Promise<{
    active: true;
    cancelledJobs: number;
    interruptedJobs: number;
    interruptedRenders: number;
    interruptedPublications: number;
    providerCancelAttempts: number;
    providerCancelUnsupported: number;
    ffmpegKillPublished: boolean;
    queuesPaused: string[];
  }> {
    const activatedAt = new Date().toISOString();
    await this.prisma.setting.upsert({
      where: { key: EMERGENCY_STOP_SETTING_KEY },
      create: {
        key: EMERGENCY_STOP_SETTING_KEY,
        value: { active: true, activatedAt, reason },
      },
      update: { value: { active: true, activatedAt, reason } },
    });
    await this.prisma.setting.upsert({
      where: { key: 'system:automation:globalPause' },
      create: { key: 'system:automation:globalPause', value: { paused: true } },
      update: { value: { paused: true } },
    });

    await this.prisma.automationConfig.updateMany({
      data: {
        runMode: AutomationRunMode.EMERGENCY_STOP,
        emergencyStopAt: new Date(),
        pausedAt: new Date(),
        enabled: false,
      },
    });

    const pauseTargets: QueueName[] = [
      QUEUE_NAMES.STORY_GENERATION,
      QUEUE_NAMES.IMAGE_GENERATION,
      QUEUE_NAMES.VIDEO_GENERATION,
      QUEUE_NAMES.SPEECH_GENERATION,
      QUEUE_NAMES.VIDEO_RENDERING,
      QUEUE_NAMES.SOCIAL_PUBLISHING,
      QUEUE_NAMES.AUTOMATION_DAILY_PLANNER,
      QUEUE_NAMES.AUTOMATION_ORCHESTRATOR,
      QUEUE_NAMES.AUTOMATION_PUBLISH_SCHEDULER,
    ];
    const queuesPaused: string[] = [];
    for (const name of pauseTargets) {
      try {
        await this.queues.getQueue(name).pause();
        queuesPaused.push(name);
      } catch (error) {
        this.logger.warn(`Could not pause queue ${name}: ${(error as Error).message}`);
      }
    }

    let cancelledJobs = 0;
    let interruptedJobs = 0;
    let interruptedRenders = 0;
    let interruptedPublications = 0;
    let providerCancelAttempts = 0;
    let providerCancelUnsupported = 0;

    for (const queueName of ALL_QUEUE_NAMES) {
      try {
        const queue = this.queues.getQueue(queueName);
        const waiting = await queue.getJobs(['waiting', 'delayed', 'paused']);
        for (const job of waiting) {
          try {
            await job.remove();
            cancelledJobs += 1;
          } catch {
            // ignore individual remove failures
          }
        }
      } catch (error) {
        this.logger.warn(`Queue drain failed for ${queueName}: ${(error as Error).message}`);
      }
    }

    const queuedJobs = await this.prisma.generationJob.findMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.QUEUED] } },
      take: 500,
    });
    for (const job of queuedJobs) {
      if (job.queueName && job.queueJobId) {
        await this.queues.removeJob(job.queueName as QueueName, job.queueJobId).catch(() => false);
      }
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Cancelled by global emergency stop',
        },
      });
      await this.recordInterrupt({
        userId: job.userId,
        entityType: 'generation_job',
        entityId: job.id,
        previousStatus: job.status,
        outcome: 'cancelled',
        queueName: job.queueName,
        queueJobId: job.queueJobId,
        reason,
      });
      cancelledJobs += 1;
    }

    const processingJobs = await this.prisma.generationJob.findMany({
      where: { status: JobStatus.PROCESSING },
      take: 500,
    });
    for (const job of processingJobs) {
      const providerTaskId =
        job.result && typeof job.result === 'object' && !Array.isArray(job.result)
          ? String((job.result as Record<string, unknown>).providerTaskId ?? '')
          : '';
      let outcome: InterruptOutcome = 'interrupt_signaled';
      if (providerTaskId && job.jobType === GenerationJobType.VIDEO) {
        providerCancelAttempts += 1;
        const cancelled = await this.kling.cancelTask(providerTaskId);
        if (cancelled) {
          outcome = 'provider_cancelled';
        } else {
          outcome = 'provider_cancel_unsupported';
          providerCancelUnsupported += 1;
        }
      }
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.INTERRUPTED,
          completedAt: new Date(),
          errorMessage:
            outcome === 'provider_cancelled'
              ? 'Interrupted by emergency stop; provider cancel acknowledged'
              : 'Interrupted by emergency stop; external provider work may still be running',
        },
      });
      await this.recordInterrupt({
        userId: job.userId,
        entityType: 'generation_job',
        entityId: job.id,
        previousStatus: job.status,
        outcome,
        providerTaskId: providerTaskId || null,
        provider: job.jobType === GenerationJobType.VIDEO ? 'kling' : null,
        queueName: job.queueName,
        queueJobId: job.queueJobId,
        reason,
        metadata: {
          honest: outcome !== 'provider_cancelled',
        },
      });
      interruptedJobs += 1;
    }

    const activeRenders = await this.prisma.videoRender.findMany({
      where: {
        status: {
          in: [
            VideoRenderStatus.PENDING,
            VideoRenderStatus.PLANNING,
            VideoRenderStatus.PREPARING_ASSETS,
            VideoRenderStatus.RENDERING_SCENES,
            VideoRenderStatus.MIXING_AUDIO,
            VideoRenderStatus.GENERATING_SUBTITLES,
            VideoRenderStatus.COMBINING,
            VideoRenderStatus.VALIDATING,
            VideoRenderStatus.UPLOADING,
          ],
        },
      },
      take: 200,
    });
    for (const render of activeRenders) {
      const wasQueued =
        render.status === VideoRenderStatus.PENDING ||
        render.status === VideoRenderStatus.PLANNING;
      await this.prisma.videoRender.update({
        where: { id: render.id },
        data: {
          status: wasQueued ? VideoRenderStatus.CANCELLED : VideoRenderStatus.INTERRUPTED,
          errorMessage: wasQueued
            ? 'Cancelled by global emergency stop'
            : 'Interrupted by emergency stop; FFmpeg kill signaled (local only)',
        },
      });
      await this.recordInterrupt({
        userId: render.userId,
        entityType: 'video_render',
        entityId: render.id,
        previousStatus: render.status,
        outcome: wasQueued ? 'cancelled' : 'ffmpeg_kill_signaled',
        reason,
      });
      if (wasQueued) cancelledJobs += 1;
      else interruptedRenders += 1;
    }

    const activePubs = await this.prisma.publishRecord.findMany({
      where: {
        status: {
          in: [
            PublishStatus.QUEUED,
            PublishStatus.VALIDATING,
            PublishStatus.UPLOADING,
            PublishStatus.PROCESSING,
            PublishStatus.PUBLISHING,
            PublishStatus.SCHEDULED,
          ],
        },
      },
      take: 300,
    });
    for (const pub of activePubs) {
      const hasExternal =
        Boolean(pub.providerUploadId) ||
        Boolean(pub.providerPublishId) ||
        Boolean(pub.providerPostId);
      const canCancelLocally =
        !hasExternal &&
        (pub.status === PublishStatus.QUEUED ||
          pub.status === PublishStatus.VALIDATING ||
          pub.status === PublishStatus.SCHEDULED ||
          pub.status === PublishStatus.UPLOADING);

      if (canCancelLocally) {
        await this.prisma.publishRecord.update({
          where: { id: pub.id },
          data: {
            status: PublishStatus.CANCELLED,
            errorMessage: 'Cancelled by global emergency stop',
          },
        });
        await this.recordInterrupt({
          userId: pub.userId,
          entityType: 'publish_record',
          entityId: pub.id,
          previousStatus: pub.status,
          outcome: 'cancelled',
          reason,
          republishBlocked: true,
        });
        cancelledJobs += 1;
      } else {
        await this.prisma.publishRecord.update({
          where: { id: pub.id },
          data: {
            status: PublishStatus.INTERRUPTED,
            errorMessage:
              'Interrupted by emergency stop; provider-side publish may still complete — do not republish until reconciled',
          },
        });
        await this.recordInterrupt({
          userId: pub.userId,
          entityType: 'publish_record',
          entityId: pub.id,
          previousStatus: pub.status,
          outcome: 'interrupt_signaled',
          providerTaskId: pub.providerPublishId ?? pub.providerUploadId ?? pub.providerPostId,
          provider: pub.platform,
          reason,
          republishBlocked: true,
          metadata: {
            providerUploadId: pub.providerUploadId,
            providerPublishId: pub.providerPublishId,
            providerPostId: pub.providerPostId,
          },
        });
        interruptedPublications += 1;
      }
    }

    const ffmpegKillPublished = await this.publishFfmpegKill(reason);

    const auditUser = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (auditUser) {
      await this.prisma.automationAuditLog
        .create({
          data: {
            userId: auditUser.id,
            action: 'ops.emergency_stop',
            before: Prisma.JsonNull,
            after: {
              reason,
              cancelledJobs,
              interruptedJobs,
              interruptedRenders,
              interruptedPublications,
              providerCancelAttempts,
              providerCancelUnsupported,
              ffmpegKillPublished,
              queuesPaused,
            },
          },
        })
        .catch((error) => {
          this.logger.warn(`Could not write emergency-stop audit: ${(error as Error).message}`);
        });
    }

    return {
      active: true,
      cancelledJobs,
      interruptedJobs,
      interruptedRenders,
      interruptedPublications,
      providerCancelAttempts,
      providerCancelUnsupported,
      ffmpegKillPublished,
      queuesPaused,
    };
  }

  async clear(resumeQueues = false): Promise<{ active: false; queuesResumed: string[] }> {
    await this.prisma.setting.upsert({
      where: { key: EMERGENCY_STOP_SETTING_KEY },
      create: { key: EMERGENCY_STOP_SETTING_KEY, value: { active: false } },
      update: { value: { active: false, clearedAt: new Date().toISOString() } },
    });
    const queuesResumed: string[] = [];
    if (resumeQueues) {
      for (const name of ALL_QUEUE_NAMES) {
        try {
          await this.queues.getQueue(name).resume();
          queuesResumed.push(name);
        } catch {
          // ignore
        }
      }
    }
    return { active: false, queuesResumed };
  }

  /** True if an interrupted publication must not be auto-republished. */
  async isRepublishBlocked(publishRecordId: string): Promise<boolean> {
    const row = await this.prisma.interruptedTask.findFirst({
      where: {
        entityType: 'publish_record',
        entityId: publishRecordId,
        republishBlocked: true,
        resolvedAt: null,
      },
    });
    return Boolean(row);
  }

  private async recordInterrupt(input: {
    userId?: string | null;
    entityType: string;
    entityId: string;
    previousStatus: string;
    outcome: InterruptOutcome;
    reason: string;
    providerTaskId?: string | null;
    provider?: string | null;
    queueName?: string | null;
    queueJobId?: string | null;
    republishBlocked?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.interruptedTask.create({
      data: {
        userId: input.userId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        previousStatus: input.previousStatus,
        outcome: input.outcome,
        reason: input.reason,
        providerTaskId: input.providerTaskId ?? null,
        provider: input.provider ?? null,
        queueName: input.queueName ?? null,
        queueJobId: input.queueJobId ?? null,
        republishBlocked: input.republishBlocked ?? true,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private async publishFfmpegKill(reason: string): Promise<boolean> {
    try {
      if (!this.publisher) {
        this.publisher = new IORedis({
          host: this.config.get<string>('redis.host', 'localhost'),
          port: this.config.get<number>('redis.port', 6379),
          password: this.config.get<string>('redis.password'),
          maxRetriesPerRequest: 1,
        });
      }
      await this.publisher.publish(
        FFMPEG_KILL_CHANNEL,
        JSON.stringify({ reason, at: new Date().toISOString() }),
      );
      return true;
    } catch (error) {
      this.logger.warn(`FFmpeg kill publish failed: ${(error as Error).message}`);
      return false;
    }
  }
}
