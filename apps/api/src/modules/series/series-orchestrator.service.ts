import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesEpisodeApprovalStatus,
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesProductionRunStatus,
  VideoRenderStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER,
  SERIES_NOTIFICATION_TYPES,
  bullMqJobId,
  isSeriesStageAutoEnabled,
  nextSeriesDialogueProductionStage,
  type SeriesDialogueProductionStageName,
  type SeriesEpisodeProductionPayload,
  type SeriesProductionStageName,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClipAssemblyService } from './clip-assembly.service';
import { ClipGenerationService } from './clip-generation.service';
import { ClipPlanningService } from './clip-planning.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesEpisodeQualityService } from './series-episode-quality.service';
import { SeriesLifecycleHandoffService } from './series-lifecycle-handoff.service';
import { SeriesPipelineAdapterService } from './series-pipeline-adapter.service';

function stagePollDelayMs(normalMs: number, useMockAi = false): number {
  if (!useMockAi) return normalMs;
  return Math.min(normalMs, 400);
}

function isMockAiEnabled(explicit?: boolean): boolean {
  if (explicit === true) return true;
  return (
    process.env.GEMINI_USE_MOCK === 'true' ||
    process.env.FAL_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}

const TERMINAL_RUN: SeriesProductionRunStatus[] = [
  SeriesProductionRunStatus.COMPLETED,
  SeriesProductionRunStatus.CANCELLED,
];

@Injectable()
export class SeriesOrchestratorService {
  private readonly logger = new Logger(SeriesOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: SeriesConfigService,
    private readonly adapter: SeriesPipelineAdapterService,
    private readonly notifications: NotificationsService,
    private readonly queueService: QueueService,
    private readonly handoff: SeriesLifecycleHandoffService,
    private readonly quality: SeriesEpisodeQualityService,
    private readonly clipPlanning: ClipPlanningService,
    private readonly clipGeneration: ClipGenerationService,
    private readonly clipAssembly: ClipAssemblyService,
  ) {}

  async startProduction(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: {
      useMockAi?: boolean;
      force?: boolean;
      async?: boolean;
      /** When true, stage auto-switches do not block (manual Produce / Run Now). */
      manualTrigger?: boolean;
    },
  ) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    const approved =
      episode.approvalStatus === SeriesEpisodeApprovalStatus.APPROVED ||
      episode.status === SeriesEpisodeStatus.APPROVED ||
      episode.status === SeriesEpisodeStatus.PRODUCING ||
      episode.status === SeriesEpisodeStatus.FAILED ||
      episode.status === SeriesEpisodeStatus.RENDERED;
    if (!approved && !options?.force) {
      throw new BadRequestException(
        `Episode must be approved before production (current: ${episode.status}, approval: ${episode.approvalStatus})`,
      );
    }
    if (!episode.script?.trim()) {
      throw new BadRequestException('Episode needs an approved screenplay before Produce');
    }

    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio before producing episodes');
    }

    // Cancel any stuck fal / narration run so Produce is not blocked on VISUAL_INTELLIGENCE.
    const activeRuns = await this.prisma.seriesProductionRun.findMany({
      where: {
        episodeId,
        status: {
          in: [
            SeriesProductionRunStatus.PENDING,
            SeriesProductionRunStatus.RUNNING,
            SeriesProductionRunStatus.RETRYING,
          ],
        },
      },
      select: { id: true, stage: true, metadata: true },
    });
    const falStages = new Set([
      'VISUAL_INTELLIGENCE',
      'MOTION_GENERATION',
      'NARRATION',
      'SPEECH',
      'RENDER',
      'VOICE_ASSIGNMENT',
      'DIALOGUE_AUDIO',
      'LIP_SYNC',
      'AUDIO_MIX',
    ]);
    for (const active of activeRuns) {
      const meta = (active.metadata ?? {}) as Record<string, unknown>;
      const stageName = active.stage ?? '';
      const isFal =
        falStages.has(stageName) ||
        meta.dialogueDriven !== true ||
        meta.pipeline !== 'grok_dialogue';
      if (isFal || options?.force || options?.manualTrigger) {
        await this.cancelRun(active.id, episodeId);
        this.logger.warn(
          `Cancelled stuck production run ${active.id} stage=${stageName} before Grok Produce`,
        );
      } else if (!options?.force) {
        throw new ConflictException(
          'Production already running for this episode. Cancel it first, or use force.',
        );
      }
    }

    const concurrent = await this.prisma.seriesEpisode.count({
      where: {
        series: { userId },
        productionState: {
          in: [SeriesEpisodeProductionState.QUEUED, SeriesEpisodeProductionState.RUNNING],
        },
        id: { not: episodeId },
      },
    });
    if (concurrent >= config.maxConcurrentEpisodeProduction && !options?.force) {
      throw new ConflictException(
        `Max concurrent episode production reached (${config.maxConcurrentEpisodeProduction})`,
      );
    }

    const latestAttempt = await this.prisma.seriesProductionRun.findFirst({
      where: { episodeId },
      orderBy: { attemptNumber: 'desc' },
    });
    const attemptNumber = (latestAttempt?.attemptNumber ?? 0) + 1;

    // Series Studio is Grok-only for all lanes (morning / evening / custom).
    // Never start the legacy fal VISUAL_INTELLIGENCE → Hailuo → narration path.
    const initialStage = SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER[0];

    const run = await this.prisma.seriesProductionRun.create({
      data: {
        userId,
        seriesId,
        episodeId,
        attemptNumber,
        status: SeriesProductionRunStatus.PENDING,
        stage: initialStage,
        metadata: {
          useMockAi: isMockAiEnabled(options?.useMockAi),
          force: options?.force === true,
          // Manual starts may run stages even when automatic stage switches are off.
          manualTrigger: options?.manualTrigger === true || options?.force === true,
          dialogueDriven: true,
          pipeline: 'grok_dialogue',
        } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        status: SeriesEpisodeStatus.PRODUCING,
        productionState: SeriesEpisodeProductionState.QUEUED,
        lastError: null,
        blockedReason: null,
      },
    });

    if (options?.async === false) {
      return this.advanceProduction({
        userId,
        seriesId,
        episodeId,
        productionRunId: run.id,
        action: 'start',
        useMockAi: options?.useMockAi,
        force: options?.force,
      });
    }

    await this.enqueueAdvance(userId, seriesId, episodeId, 'start', 0, run.id, options?.useMockAi);
    return { queued: true, productionRunId: run.id, episodeId };
  }

  async advanceProduction(payload: SeriesEpisodeProductionPayload) {
    const episode = await this.requireEpisode(payload.userId, payload.seriesId, payload.episodeId);
    const run = await this.resolveRun(payload, episode.id);

    if (TERMINAL_RUN.includes(run.status) && !payload.force) {
      return { skipped: true, reason: `Production run is ${run.status}` };
    }
    if (run.status === SeriesProductionRunStatus.CANCELLED && !payload.force) {
      return { skipped: true, reason: 'Production run cancelled' };
    }

    if (payload.action === 'cancel') {
      return this.cancelRun(run.id, episode.id);
    }

    const config = await this.configService.getOrCreate(payload.userId);
    if (!config.seriesStudioEnabled && !payload.force) {
      return { skipped: true, reason: 'Series Studio disabled' };
    }

    const useMockAi = isMockAiEnabled(payload.useMockAi);
    const runMeta = (run.metadata as Record<string, unknown>) ?? {};
    let stage =
      (run.stage as SeriesProductionStageName | SeriesDialogueProductionStageName) ||
      'MATERIALIZE';

    // Migrate any in-flight fal/narration run onto the Grok dialogue path.
    const falOrNarrationStages = new Set<string>([
      'VISUAL_INTELLIGENCE',
      'MOTION_GENERATION',
      'NARRATION',
      'SPEECH',
      'RENDER',
      'VOICE_ASSIGNMENT',
      'DIALOGUE_AUDIO',
      'LIP_SYNC',
      'AUDIO_MIX',
    ]);
    if (runMeta.dialogueDriven !== true || falOrNarrationStages.has(stage)) {
      const migratedStage = falOrNarrationStages.has(stage) ? 'CLIP_GENERATION' : stage;
      await this.prisma.seriesProductionRun.update({
        where: { id: run.id },
        data: {
          stage: migratedStage,
          metadata: {
            ...runMeta,
            dialogueDriven: true,
            pipeline: 'grok_dialogue',
            migratedFromFalPath: falOrNarrationStages.has(stage),
            migratedFromStage: stage,
          } as Prisma.InputJsonValue,
        },
      });
      stage = migratedStage as SeriesDialogueProductionStageName;
    }

    try {
      await this.prisma.seriesProductionRun.update({
        where: { id: run.id },
        data: {
          status: SeriesProductionRunStatus.RUNNING,
          startedAt: run.startedAt ?? new Date(),
          errorMessage: null,
        },
      });
      await this.prisma.seriesEpisode.update({
        where: { id: episode.id },
        data: {
          productionState: SeriesEpisodeProductionState.RUNNING,
          status: SeriesEpisodeStatus.PRODUCING,
        },
      });

      const stageGate = await this.gateAutomaticStage(
        payload,
        run,
        episode.id,
        stage as SeriesProductionStageName,
        config,
      );
      if (stageGate) return stageGate;

      // Grok dialogue pipeline only — fal VISUAL_INTELLIGENCE / Hailuo / narration removed from Series.
      switch (stage as SeriesDialogueProductionStageName) {
        case 'MATERIALIZE':
          return this.ensureMaterialize(payload, run, useMockAi);
        case 'CLIP_GENERATION':
          return this.ensureClipGeneration(payload, run, useMockAi);
        case 'ASSEMBLY':
          return this.ensureClipAssembly(payload, run, episode, useMockAi);
        case 'DONE':
          return this.completeDone(run, episode.id);
        case 'VOICE_ASSIGNMENT':
        case 'VISUAL_INTELLIGENCE':
        case 'DIALOGUE_AUDIO':
        case 'LIP_SYNC':
        case 'AUDIO_MIX': {
          await this.completeStage(run.id, stage);
          await this.enqueueAdvance(
            payload.userId,
            payload.seriesId,
            payload.episodeId,
            'advance',
            stagePollDelayMs(500, useMockAi),
            run.id,
            useMockAi,
          );
          return {
            skipped: true,
            reason: 'Grok text-to-video path skips fal stills / TTS / lip-sync',
            stage,
            next: 'CLIP_GENERATION',
          };
        }
        default:
          throw new Error(`Unknown series production stage: ${stage}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Series production failed episode=${episode.id}: ${message}`);
      const meta = (run.metadata as Record<string, unknown>) ?? {};
      const retryCount = typeof meta.retryCount === 'number' ? meta.retryCount + 1 : 1;
      const maxRetries = config.maxRetries ?? 3;

      await this.prisma.seriesProductionRun.update({
        where: { id: run.id },
        data: {
          status:
            retryCount >= maxRetries
              ? SeriesProductionRunStatus.FAILED
              : SeriesProductionRunStatus.RETRYING,
          errorMessage: message,
          metadata: { ...meta, retryCount } as Prisma.InputJsonValue,
          ...(retryCount >= maxRetries ? { completedAt: new Date() } : {}),
        },
      });

      if (retryCount >= maxRetries) {
        await this.prisma.seriesEpisode.update({
          where: { id: episode.id },
          data: {
            status: SeriesEpisodeStatus.FAILED,
            productionState: SeriesEpisodeProductionState.FAILED,
            lastError: message,
          },
        });
        await this.notifications.notify({
          userId: payload.userId,
          type: SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED,
          title: 'Series episode production failed',
          body: message,
          dedupeKey: `series-prod-fail:${episode.id}:${run.id}`,
        });
        return { failed: true, error: message, retryCount };
      }

      const delay = Math.min(300_000, 5000 * 2 ** retryCount);
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'retry',
        delay,
        run.id,
        useMockAi,
      );
      return { failed: true, error: message, retryCount, retrying: true };
    }
  }

  async cancelProduction(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    const run = await this.prisma.seriesProductionRun.findFirst({
      where: {
        episodeId: episode.id,
        status: {
          in: [
            SeriesProductionRunStatus.PENDING,
            SeriesProductionRunStatus.RUNNING,
            SeriesProductionRunStatus.RETRYING,
          ],
        },
      },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!run) throw new NotFoundException('No active production run to cancel');
    return this.cancelRun(run.id, episode.id);
  }

  async getProductionStatus(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    const runs = await this.prisma.seriesProductionRun.findMany({
      where: { episodeId: episode.id },
      orderBy: { attemptNumber: 'desc' },
      take: 10,
    });
    return {
      episode: {
        id: episode.id,
        status: episode.status,
        productionState: episode.productionState,
        storyId: episode.storyId,
        videoProjectId: episode.videoProjectId,
        videoRenderId: episode.videoRenderId,
        lastError: episode.lastError,
      },
      runs,
    };
  }

  async enqueueAdvance(
    userId: string,
    seriesId: string,
    episodeId: string,
    action: SeriesEpisodeProductionPayload['action'] = 'advance',
    delayMs = 0,
    productionRunId?: string,
    useMockAi?: boolean,
  ) {
    const queue = this.queueService.getQueue(QUEUE_NAMES.SERIES_EPISODE_PRODUCTION);
    const jobId = bullMqJobId('series-prod', episodeId, action, Date.now());
    await queue.add(
      action,
      {
        userId,
        seriesId,
        episodeId,
        productionRunId,
        action,
        useMockAi: useMockAi ?? isMockAiEnabled(),
      } satisfies SeriesEpisodeProductionPayload,
      {
        jobId,
        delay: Math.max(0, delayMs),
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    if (productionRunId) {
      const run = await this.prisma.seriesProductionRun.findUnique({
        where: { id: productionRunId },
      });
      if (run) {
        const ids = Array.isArray(run.bullJobIds) ? [...(run.bullJobIds as string[])] : [];
        ids.push(jobId);
        await this.prisma.seriesProductionRun.update({
          where: { id: productionRunId },
          data: { bullJobIds: ids.slice(-20) as Prisma.InputJsonValue },
        });
      }
    }
    return { jobId };
  }

  private async ensureMaterialize(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    useMockAi: boolean,
  ) {
    const materialized = await this.adapter.materializeEpisode(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      { force: payload.force === true },
    );
    await this.completeStage(run.id, 'MATERIALIZE', {
      storyId: materialized.storyId,
      videoProjectId: materialized.videoProjectId,
    });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(1000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'MATERIALIZE', ...materialized };
  }

  private async completeDone(run: { id: string }, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { series: { select: { userId: true } } },
    });
    await this.prisma.$transaction([
      this.prisma.seriesProductionRun.update({
        where: { id: run.id },
        data: {
          status: SeriesProductionRunStatus.COMPLETED,
          stage: 'DONE',
          completedAt: new Date(),
        },
      }),
      this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          status: SeriesEpisodeStatus.RENDERED,
          productionState: SeriesEpisodeProductionState.COMPLETED,
          lastError: null,
          blockedReason: null,
        },
      }),
    ]);

    const quality = await this.quality.evaluateRenderedEpisode(
      episode.series.userId,
      episodeId,
    );

    const hardFailed = quality.checks.some((c) => c.hard && !c.passed);
    // Soft score misses (duration slack, etc.) must not wipe a completed Grok assemble —
    // only hard gates (script/scenes/render/asset/speakers/clips) fail the episode.
    if (hardFailed) {
      const failedHard = quality.checks
        .filter((c) => c.hard && !c.passed)
        .map((c) => c.id)
        .join(', ');
      await this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          status: SeriesEpisodeStatus.FAILED,
          productionState: SeriesEpisodeProductionState.FAILED,
          lastError: `Quality check failed (hard: ${failedHard || 'unknown'}; score=${quality.score.toFixed(2)})`,
          blockedReason: quality.blockedReason ?? 'quality_check_failed',
        },
      });
      await this.notifications.notify({
        userId: episode.series.userId,
        type: SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED,
        title: 'Episode failed quality check',
        body: `Episode ${episode.episodeNumber} render completed but failed a required quality gate.`,
        dedupeKey: `series-quality-fail:${episode.id}:${run.id}`,
        metadata: { episodeId, quality },
      });
      return { completed: false, stage: 'DONE', episodeId, quality };
    }

    await this.notifications.notify({
      userId: episode.series.userId,
      type: SERIES_NOTIFICATION_TYPES.EPISODE_RENDERED,
      title: 'Series episode render completed',
      body: `Episode ${episode.episodeNumber} passed quality checks and is ready for scheduling.`,
      dedupeKey: `series-render-done:${episode.id}:${episode.videoRenderId ?? run.id}`,
    });

    try {
      await this.handoff.afterEpisodeRendered(
        episode.series.userId,
        episode.seriesId,
        episodeId,
      );
    } catch (error) {
      this.logger.warn(
        `Post-render publish handoff failed episode=${episodeId}: ${(error as Error).message}`,
      );
    }

    return { completed: true, stage: 'DONE', episodeId, quality };
  }

  /**
   * Stop automatic production at a disabled stage (do not silently skip).
   * Manual / force runs bypass automatic stage switches.
   */
  private async gateAutomaticStage(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string; metadata: unknown },
    episodeId: string,
    stage: SeriesProductionStageName,
    config: {
      automaticEpisodeProduction: boolean;
      automaticVisualGeneration: boolean;
      automaticMotionGeneration: boolean;
      automaticNarration: boolean;
      automaticRendering: boolean;
    },
  ) {
    if (stage === 'MATERIALIZE' || stage === 'DONE') return null;

    const meta = (run.metadata as Record<string, unknown>) ?? {};
    const manual =
      payload.force === true || meta.manualTrigger === true || meta.force === true;
    if (manual) return null;

    const stageSwitch: Record<string, { enabled: boolean; setting: string }> = {
      VISUAL_INTELLIGENCE: {
        enabled: config.automaticVisualGeneration,
        setting: 'automaticVisualGeneration',
      },
      MOTION_GENERATION: {
        enabled: config.automaticMotionGeneration,
        setting: 'automaticMotionGeneration',
      },
      NARRATION: {
        enabled: config.automaticNarration,
        setting: 'automaticNarration',
      },
      SPEECH: {
        enabled: config.automaticNarration,
        setting: 'automaticNarration',
      },
      VOICE_ASSIGNMENT: {
        enabled: config.automaticNarration,
        setting: 'automaticNarration',
      },
      DIALOGUE_AUDIO: {
        enabled: config.automaticNarration,
        setting: 'automaticNarration',
      },
      LIP_SYNC: {
        enabled: config.automaticMotionGeneration,
        setting: 'automaticMotionGeneration',
      },
      AUDIO_MIX: {
        enabled: config.automaticNarration,
        setting: 'automaticNarration',
      },
      CLIP_GENERATION: {
        // Grok T2V does not use Hailuo/Kling motion — only the production master switch.
        enabled: true,
        setting: 'automaticEpisodeProduction',
      },
      ASSEMBLY: {
        enabled: config.automaticRendering,
        setting: 'automaticRendering',
      },
      RENDER: {
        enabled: config.automaticRendering,
        setting: 'automaticRendering',
      },
    };

    const gate = stageSwitch[stage];
    if (!gate) return null;

    const allowed = isSeriesStageAutoEnabled(
      config.automaticEpisodeProduction,
      gate.enabled,
    );
    if (allowed) return null;

    const reason = !config.automaticEpisodeProduction
      ? `Automatic Episode Production is OFF — enable it (and ${gate.setting}) or use Produce Next / Run Now.`
      : `${gate.setting} is OFF — enable it to continue automatic production, or run Produce Next manually.`;

    await this.prisma.seriesProductionRun.update({
      where: { id: run.id },
      data: {
        status: SeriesProductionRunStatus.CANCELLED,
        completedAt: new Date(),
        errorMessage: reason,
        metadata: {
          ...meta,
          blockedAtStage: stage,
          blockedReason: reason,
        } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        status: SeriesEpisodeStatus.APPROVED,
        productionState: SeriesEpisodeProductionState.IDLE,
        blockedReason: reason,
        lastError: reason,
      },
    });

    return {
      blocked: true,
      stage,
      reason,
      setting: gate.setting,
    };
  }

  /**
   * Phase 4/5: ensure clip plan exists and all Grok Lite clips are COMPLETED.
   * Does not use narration readiness.
   */
  private async ensureClipGeneration(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    useMockAi: boolean,
  ) {
    let clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId: payload.episodeId },
      select: {
        id: true,
        status: true,
        videoMediaAssetId: true,
        action: true,
        dialogue: true,
      },
    });

    const plannedOnly = clips.every(
      (c) => c.status === 'PLANNED' || c.status === 'FAILED' || c.status === 'CANCELLED',
    );
    const duplicateActions =
      plannedOnly &&
      clips.length >= 2 &&
      clips.some((a, i) =>
        clips.slice(i + 1).some(
          (b) =>
            (a.action || '').trim() &&
            (a.action || '').trim().toLowerCase() === (b.action || '').trim().toLowerCase(),
        ),
      );
    // Old literary fallback buried speech in ACTION with empty DIALOGUE — Grok then skipped lines.
    const missingSpokenDialogue =
      plannedOnly &&
      clips.length > 0 &&
      clips.every((c) => !(c.dialogue || '').trim()) &&
      clips.some((c) =>
        /\b(who is|will you|i'm done|marry me|claire|elena|leo)\b/i.test(c.action || ''),
      );

    if (clips.length === 0 || duplicateActions || missingSpokenDialogue) {
      try {
        await this.clipPlanning.planClips(
          payload.userId,
          payload.seriesId,
          payload.episodeId,
          { force: true },
        );
      } catch (error) {
        throw new Error(
          `Clip plan required before CLIP_GENERATION: ${(error as Error).message}`,
        );
      }
      clips = await this.prisma.episodeVideoClip.findMany({
        where: { episodeId: payload.episodeId },
        select: {
          id: true,
          status: true,
          videoMediaAssetId: true,
          action: true,
          dialogue: true,
        },
      });
    }

    const completed = clips.filter(
      (c) => c.status === 'COMPLETED' && c.videoMediaAssetId,
    );
    if (clips.length > 0 && completed.length === clips.length) {
      await this.completeStage(run.id, 'CLIP_GENERATION');
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(500, useMockAi),
        run.id,
        useMockAi,
      );
      return {
        completed: true,
        stage: 'CLIP_GENERATION',
        clipCount: clips.length,
      };
    }

    const failed = clips.filter((c) => c.status === 'FAILED');
    if (failed.length > 0 && failed.length === clips.length - completed.length) {
      // All remaining failed — surface error
      throw new Error(
        `CLIP_GENERATION failed for ${failed.length} clip(s). Retry clip generation.`,
      );
    }

    const pending = clips.filter(
      (c) => c.status !== 'COMPLETED' || !c.videoMediaAssetId,
    );
    if (pending.length > 0) {
      await this.clipGeneration.generateEpisodeClips(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        {
          useMockAi,
          async: true,
          force: false,
          mode: 'auto',
        },
      );
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(8000, useMockAi),
        run.id,
        useMockAi,
      );
      return {
        waiting: true,
        stage: 'CLIP_GENERATION',
        completed: completed.length,
        pending: pending.length,
      };
    }

    await this.completeStage(run.id, 'CLIP_GENERATION');
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(500, useMockAi),
      run.id,
      useMockAi,
    );
    return { completed: true, stage: 'CLIP_GENERATION' };
  }

  /**
   * Phase 5: FFmpeg-assemble COMPLETED clips into VideoRender.
   * Bypasses narration gate (no ensureNarrationApproved / RenderingService readiness).
   */
  private async ensureClipAssembly(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    episode: {
      id: string;
      storyId: string | null;
      videoRenderId: string | null;
    },
    useMockAi: boolean,
  ) {
    if (episode.videoRenderId) {
      const render = await this.prisma.videoRender.findUnique({
        where: { id: episode.videoRenderId },
      });
      if (render?.status === VideoRenderStatus.COMPLETED && render.outputMediaAssetId) {
        const settings = (render.renderSettings ?? {}) as Record<string, unknown>;
        const assembledIds = Array.isArray(settings.clipIds)
          ? [...(settings.clipIds as string[])].sort()
          : [];
        const currentIds = (
          await this.prisma.episodeVideoClip.findMany({
            where: {
              episodeId: episode.id,
              status: 'COMPLETED',
              videoMediaAssetId: { not: null },
            },
            select: { id: true },
          })
        )
          .map((c) => c.id)
          .sort();
        const clipsMatch =
          assembledIds.length > 0 &&
          assembledIds.length === currentIds.length &&
          assembledIds.every((id, i) => id === currentIds[i]);
        // Only reuse the old render when it was built from these exact clips.
        if (
          clipsMatch &&
          (settings.source === 'clip_assembly' || settings.dialogueDriven === true)
        ) {
          await this.completeStage(run.id, 'ASSEMBLY', { videoRenderId: render.id });
          await this.enqueueAdvance(
            payload.userId,
            payload.seriesId,
            payload.episodeId,
            'advance',
            stagePollDelayMs(500, useMockAi),
            run.id,
            useMockAi,
          );
          return { completed: true, stage: 'ASSEMBLY', videoRenderId: render.id };
        }
      }
    }

    const status = await this.clipAssembly.getAssemblyStatus(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
    );
    if (!status.readyToAssemble) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(5000, useMockAi),
        run.id,
        useMockAi,
      );
      return {
        waiting: true,
        stage: 'ASSEMBLY',
        reason: 'Clips not ready',
        missing: status.missingClips,
      };
    }

    // Run FFmpeg in-process (no narration gate). Always force when we reach here so a
    // stale 2-clip render cannot block the new dialogue packs.
    const assembled = await this.clipAssembly.assemble(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      { force: true },
    );

    await this.completeStage(run.id, 'ASSEMBLY', {
      videoRenderId: assembled.videoRenderId,
      outputMediaAssetId: assembled.outputMediaAssetId,
    });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(500, useMockAi),
      run.id,
      useMockAi,
    );
    return {
      completed: true,
      stage: 'ASSEMBLY',
      videoRenderId: assembled.videoRenderId,
      durationSeconds: assembled.durationSeconds,
    };
  }

  private async completeStage(
    runId: string,
    stage: SeriesProductionStageName | SeriesDialogueProductionStageName,
    extraMeta?: Record<string, unknown>,
  ) {
    const run = await this.prisma.seriesProductionRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const priorMeta = (run.metadata as Record<string, unknown>) ?? {};
    const next = nextSeriesDialogueProductionStage(
      stage as SeriesDialogueProductionStageName,
    );
    const meta = {
      ...priorMeta,
      ...(extraMeta ?? {}),
      [`completed:${stage}`]: new Date().toISOString(),
    };
    await this.prisma.seriesProductionRun.update({
      where: { id: runId },
      data: {
        stage: next ?? 'DONE',
        metadata: meta as Prisma.InputJsonValue,
      },
    });
  }

  private async cancelRun(runId: string, episodeId: string) {
    await this.prisma.$transaction([
      this.prisma.seriesProductionRun.update({
        where: { id: runId },
        data: {
          status: SeriesProductionRunStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Cancelled by user',
        },
      }),
      this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          productionState: SeriesEpisodeProductionState.CANCELLED,
        },
      }),
    ]);
    return { cancelled: true, productionRunId: runId };
  }

  private async requireEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }

  private async resolveRun(
    payload: SeriesEpisodeProductionPayload,
    episodeId: string,
  ) {
    if (payload.productionRunId) {
      const run = await this.prisma.seriesProductionRun.findFirst({
        where: {
          id: payload.productionRunId,
          episodeId,
          userId: payload.userId,
        },
      });
      if (!run) throw new NotFoundException('Production run not found');
      return run;
    }
    const run = await this.prisma.seriesProductionRun.findFirst({
      where: { episodeId, userId: payload.userId },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!run) throw new NotFoundException('No production run for episode');
    return run;
  }
}
