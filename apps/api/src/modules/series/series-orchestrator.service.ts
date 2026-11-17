import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AudioGenerationStatus,
  JobStatus,
  MotionGenerationStatus,
  NarrationScriptStatus,
  Prisma,
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesProductionRunStatus,
  VideoRenderStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER,
  SERIES_NOTIFICATION_TYPES,
  SERIES_PRODUCTION_STAGE_ORDER,
  bullMqJobId,
  isSeriesStageAutoEnabled,
  nextSeriesDialogueProductionStage,
  nextSeriesProductionStage,
  type SeriesDialogueProductionStageName,
  type SeriesEpisodeProductionPayload,
  type SeriesProductionStageName,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { MotionService } from '../motion/motion.service';
import { NarrationService } from '../narration/narration.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RenderingService } from '../rendering/rendering.service';
import { VisualsService } from '../visuals/visuals.service';
import { DialogueProductionService } from './dialogue-production.service';
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
    private readonly visualsService: VisualsService,
    private readonly motionService: MotionService,
    private readonly narrationService: NarrationService,
    private readonly renderingService: RenderingService,
    private readonly notifications: NotificationsService,
    private readonly queueService: QueueService,
    private readonly handoff: SeriesLifecycleHandoffService,
    private readonly quality: SeriesEpisodeQualityService,
    private readonly dialogueProduction: DialogueProductionService,
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
    if (episode.status !== SeriesEpisodeStatus.APPROVED && !options?.force) {
      if (episode.status !== SeriesEpisodeStatus.PRODUCING && episode.status !== SeriesEpisodeStatus.FAILED) {
        throw new BadRequestException(
          `Episode must be APPROVED before production (current: ${episode.status})`,
        );
      }
    }

    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio before producing episodes');
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

    const dialogueDriven = await this.dialogueProduction.isDialogueDrivenForEpisode(
      userId,
      seriesId,
    );
    const initialStage = dialogueDriven
      ? SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER[0]
      : SERIES_PRODUCTION_STAGE_ORDER[0];

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
          dialogueDriven,
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
    const dialogueDriven = runMeta.dialogueDriven === true;
    const stage =
      (run.stage as SeriesProductionStageName | SeriesDialogueProductionStageName) ||
      'MATERIALIZE';

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

      if (dialogueDriven) {
        switch (stage as SeriesDialogueProductionStageName) {
          case 'MATERIALIZE':
            return this.ensureMaterialize(payload, run, useMockAi);
          case 'VOICE_ASSIGNMENT':
            return this.ensureDialogueVoiceAssignment(payload, run);
          case 'VISUAL_INTELLIGENCE':
            return this.ensureVisuals(payload, run, episode.storyId, useMockAi);
          case 'DIALOGUE_AUDIO':
            return this.ensureDialogueAudio(payload, run, useMockAi);
          case 'LIP_SYNC':
            return this.ensureLipSync(payload, run, useMockAi);
          case 'AUDIO_MIX':
            return this.ensureDialogueAudioMix(payload, run);
          case 'RENDER':
            return this.ensureRender(payload, run, episode, useMockAi);
          case 'DONE':
            return this.completeDone(run, episode.id);
          default:
            throw new Error(`Unknown dialogue production stage: ${stage}`);
        }
      }

      switch (stage as SeriesProductionStageName) {
        case 'MATERIALIZE':
          return this.ensureMaterialize(payload, run, useMockAi);
        case 'VISUAL_INTELLIGENCE':
          return this.ensureVisuals(payload, run, episode.storyId, useMockAi);
        case 'MOTION_GENERATION':
          return this.ensureMotion(payload, run, episode.storyId, useMockAi);
        case 'NARRATION':
          return this.ensureNarration(payload, run, episode.storyId, useMockAi);
        case 'SPEECH':
          return this.ensureSpeech(payload, run, episode.storyId, useMockAi);
        case 'RENDER':
          return this.ensureRender(payload, run, episode, useMockAi);
        case 'DONE':
          return this.completeDone(run, episode.id);
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

  private async ensureVisuals(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    storyId: string | null,
    useMockAi: boolean,
  ) {
    if (!storyId) throw new Error('Missing storyId after materialize');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId },
      include: {
        visuals: {
          where: {
            generationStatus: VisualGenerationStatus.COMPLETED,
            generatedImageMediaId: { not: null },
          },
        },
      },
    });
    if (scenes.length === 0) throw new Error('No scenes available for visuals');

    if (scenes.every((scene) => scene.visuals.length > 0)) {
      await this.completeStage(run.id, 'VISUAL_INTELLIGENCE');
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(1000, useMockAi),
        run.id,
        useMockAi,
      );
      return { completed: true, stage: 'VISUAL_INTELLIGENCE' };
    }

    const active = await this.prisma.generationJob.findFirst({
      where: {
        storyId,
        jobType: { in: ['VISUAL_ANALYSIS', 'CHARACTER_REFERENCE', 'IMAGE'] },
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(6000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'VISUAL_INTELLIGENCE' };
    }

    // Series already projected approved character refs — skip regenerating character portraits.
    await this.visualsService.generateForStory(payload.userId, storyId, {
      skipCharacterReferences: true,
    });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(6000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'VISUAL_INTELLIGENCE' };
  }

  private async ensureMotion(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    storyId: string | null,
    useMockAi: boolean,
  ) {
    if (!storyId) throw new Error('Missing storyId');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId },
      include: {
        motionGenerations: {
          where: {
            status: MotionGenerationStatus.COMPLETED,
            outputMediaAssetId: { not: null },
          },
        },
      },
    });
    if (scenes.every((scene) => scene.motionGenerations.length > 0)) {
      await this.completeStage(run.id, 'MOTION_GENERATION');
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(1000, useMockAi),
        run.id,
        useMockAi,
      );
      return { completed: true, stage: 'MOTION_GENERATION' };
    }

    const active = await this.prisma.motionGeneration.findFirst({
      where: {
        storyId,
        status: {
          in: [
            MotionGenerationStatus.PENDING,
            MotionGenerationStatus.ANALYZING,
            MotionGenerationStatus.SUBMITTING,
            MotionGenerationStatus.PROCESSING,
            MotionGenerationStatus.DOWNLOADING,
            MotionGenerationStatus.VALIDATING,
          ],
        },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(8000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'MOTION_GENERATION' };
    }

    await this.motionService.generateForStory(payload.userId, storyId, {});
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(8000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'MOTION_GENERATION' };
  }

  private async ensureNarration(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    storyId: string | null,
    useMockAi: boolean,
  ) {
    if (!storyId) throw new Error('Missing storyId');
    const script = await this.prisma.narrationScript.findFirst({
      where: {
        storyId,
        status: { in: [NarrationScriptStatus.READY, NarrationScriptStatus.APPROVED] },
      },
      orderBy: { version: 'desc' },
    });
    if (script) {
      await this.completeStage(run.id, 'NARRATION');
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(1000, useMockAi),
        run.id,
        useMockAi,
      );
      return { completed: true, stage: 'NARRATION' };
    }

    const active = await this.prisma.generationJob.findFirst({
      where: {
        storyId,
        jobType: 'NARRATION_PLANNING',
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(5000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'NARRATION' };
    }

    await this.narrationService.planNarration(payload.userId, storyId, { useMockAi });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(5000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'NARRATION' };
  }

  private async ensureSpeech(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    storyId: string | null,
    useMockAi: boolean,
  ) {
    if (!storyId) throw new Error('Missing storyId');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId },
      include: {
        audioGenerations: {
          where: {
            status: AudioGenerationStatus.COMPLETED,
            audioMediaAssetId: { not: null },
            isSelected: true,
          },
        },
      },
    });
    const ready =
      scenes.length > 0 && scenes.every((scene) => scene.audioGenerations.length > 0);
    if (ready) {
      await this.ensureNarrationApproved(payload.userId, storyId);
      await this.completeStage(run.id, 'SPEECH');
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(1000, useMockAi),
        run.id,
        useMockAi,
      );
      return { completed: true, stage: 'SPEECH' };
    }

    const active = await this.prisma.audioGeneration.findFirst({
      where: {
        storyId,
        status: {
          in: [
            AudioGenerationStatus.PENDING,
            AudioGenerationStatus.GENERATING,
            AudioGenerationStatus.VALIDATING,
            AudioGenerationStatus.STORING,
          ],
        },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(6000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'SPEECH' };
    }

    await this.ensureNarrationApproved(payload.userId, storyId);
    await this.narrationService.generateStoryAudio(payload.userId, storyId, { useMockAi });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(6000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'SPEECH' };
  }

  private async ensureRender(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    episode: {
      id: string;
      storyId: string | null;
      videoRenderId: string | null;
    },
    useMockAi: boolean,
  ) {
    if (!episode.storyId) throw new Error('Missing storyId');

    if (episode.videoRenderId) {
      const render = await this.prisma.videoRender.findUnique({
        where: { id: episode.videoRenderId },
      });
      if (render?.status === VideoRenderStatus.COMPLETED && render.outputMediaAssetId) {
        await this.completeStage(run.id, 'RENDER', { videoRenderId: render.id });
        await this.enqueueAdvance(
          payload.userId,
          payload.seriesId,
          payload.episodeId,
          'advance',
          stagePollDelayMs(500, useMockAi),
          run.id,
          useMockAi,
        );
        return { completed: true, stage: 'RENDER', videoRenderId: render.id };
      }
      if (render) {
        const terminal: VideoRenderStatus[] = [
          VideoRenderStatus.FAILED,
          VideoRenderStatus.CANCELLED,
          VideoRenderStatus.COMPLETED,
        ];
        if (!terminal.includes(render.status)) {
          await this.enqueueAdvance(
            payload.userId,
            payload.seriesId,
            payload.episodeId,
            'advance',
            stagePollDelayMs(8000, useMockAi),
            run.id,
            useMockAi,
          );
          return { waiting: true, stage: 'RENDER' };
        }
        if (render.status === VideoRenderStatus.FAILED) {
          throw new Error(render.errorMessage ?? 'Render failed');
        }
      }
    }

    await this.ensureNarrationApproved(payload.userId, episode.storyId);
    const readiness = await this.renderingService.getReadiness(
      payload.userId,
      episode.storyId,
    );
    if (!readiness.canRender) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(8000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, reason: 'Render readiness not met', missing: readiness.missing };
    }

    const render = await this.renderingService.createRender(
      payload.userId,
      episode.storyId,
      {},
    );
    await this.prisma.seriesEpisode.update({
      where: { id: episode.id },
      data: { videoRenderId: render.id },
    });
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(8000, useMockAi),
      run.id,
      useMockAi,
    );
    return { started: true, stage: 'RENDER', videoRenderId: render.id };
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
        },
      }),
    ]);

    const quality = await this.quality.evaluateRenderedEpisode(
      episode.series.userId,
      episodeId,
    );

    if (!quality.passed) {
      await this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          status: SeriesEpisodeStatus.FAILED,
          productionState: SeriesEpisodeProductionState.FAILED,
          lastError: `Quality check failed (score=${quality.score.toFixed(2)}, threshold=${quality.threshold.toFixed(2)}; failed: ${quality.checks
            .filter((c) => !c.passed)
            .map((c) => c.id)
            .join(', ') || 'none'})`,
          blockedReason: quality.blockedReason ?? 'quality_check_failed',
        },
      });
      await this.notifications.notify({
        userId: episode.series.userId,
        type: SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED,
        title: 'Episode failed quality check',
        body: `Episode ${episode.episodeNumber} render completed but failed automated quality validation.`,
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

  private async ensureNarrationApproved(userId: string, storyId: string) {
    const script = await this.prisma.narrationScript.findFirst({
      where: {
        userId,
        storyId,
        status: { in: [NarrationScriptStatus.READY, NarrationScriptStatus.APPROVED] },
      },
      orderBy: { version: 'desc' },
    });
    if (!script) {
      throw new Error('Narration script is not ready for automated render approval');
    }
    if (script.status === NarrationScriptStatus.APPROVED) return script;
    return this.narrationService.approveScript(userId, script.id);
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

  private async ensureDialogueVoiceAssignment(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
  ) {
    await this.dialogueProduction.ensureVoiceAssignment(payload.userId, payload.seriesId);
    await this.completeStage(run.id, 'VOICE_ASSIGNMENT' as SeriesProductionStageName);
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(500, false),
      run.id,
      payload.useMockAi,
    );
    return { completed: true, stage: 'VOICE_ASSIGNMENT' };
  }

  private async ensureDialogueAudio(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    useMockAi: boolean,
  ) {
    const lines = await this.prisma.episodeDialogueLine.findMany({
      where: { episodeId: payload.episodeId, userId: payload.userId },
    });
    if (lines.length === 0) {
      throw new Error('No dialogue lines materialized for DIALOGUE_AUDIO stage');
    }

    // Enqueue dedicated dialogue-audio worker job; poll until lines leave AUDIO_PENDING.
    const pending = lines.filter((l) => l.status === 'AUDIO_PENDING' || l.status === 'DRAFT');
    if (pending.length > 0) {
      await this.queueService.getQueue(QUEUE_NAMES.SERIES_DIALOGUE_AUDIO).add(
        'dialogue_audio',
        {
          userId: payload.userId,
          seriesId: payload.seriesId,
          episodeId: payload.episodeId,
          productionRunId: run.id,
          useMockAi,
        },
        { jobId: bullMqJobId('series-dialogue-audio', payload.episodeId, run.id) },
      );
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(5000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'DIALOGUE_AUDIO', pending: pending.length };
    }

    await this.completeStage(run.id, 'DIALOGUE_AUDIO' as SeriesProductionStageName);
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(500, useMockAi),
      run.id,
      useMockAi,
    );
    return { completed: true, stage: 'DIALOGUE_AUDIO' };
  }

  private async ensureLipSync(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
    useMockAi: boolean,
  ) {
    await this.dialogueProduction.createLipSyncJobs(
      payload.userId,
      payload.episodeId,
    );
    await this.queueService.getQueue(QUEUE_NAMES.SERIES_LIP_SYNC).add(
      'lip_sync',
      {
        userId: payload.userId,
        seriesId: payload.seriesId,
        episodeId: payload.episodeId,
        productionRunId: run.id,
        useMockAi,
      },
      { jobId: bullMqJobId('series-lip-sync', payload.episodeId, run.id) },
    );

    const required = await this.prisma.episodeShot.count({
      where: { episodeId: payload.episodeId, requiresLipSync: true },
    });
    const completed = await this.prisma.lipSyncJob.count({
      where: {
        episodeId: payload.episodeId,
        status: 'COMPLETED',
      },
    });
    if (required > 0 && completed < required) {
      await this.enqueueAdvance(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        'advance',
        stagePollDelayMs(8000, useMockAi),
        run.id,
        useMockAi,
      );
      return { waiting: true, stage: 'LIP_SYNC', required, completed };
    }

    await this.completeStage(run.id, 'LIP_SYNC' as SeriesProductionStageName);
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
      stage: 'LIP_SYNC',
      required,
      lipSyncCompleted: completed,
    };
  }

  private async ensureDialogueAudioMix(
    payload: SeriesEpisodeProductionPayload,
    run: { id: string },
  ) {
    const lines = await this.prisma.episodeDialogueLine.findMany({
      where: { episodeId: payload.episodeId },
      orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }, { lineOrder: 'asc' }],
    });
    const cueSheet = lines.map((line) => ({
      speaker: line.speakerName,
      text: line.text,
      startMs: line.startMs,
      endMs: line.endMs,
      audioMediaAssetId: line.audioMediaAssetId,
    }));
    const subtitleCues = lines.map((line) => ({
      speaker: line.speakerName,
      text: line.text,
      startMs: line.startMs ?? 0,
      endMs: line.endMs ?? 0,
    }));

    await this.prisma.episodeAudioMix.upsert({
      where: {
        episodeId_version: { episodeId: payload.episodeId, version: 1 },
      },
      create: {
        userId: payload.userId,
        episodeId: payload.episodeId,
        version: 1,
        status: 'READY',
        dialogueGainDb: 0,
        musicGainDb: -12,
        ambientGainDb: -18,
        cueSheet: cueSheet as unknown as Prisma.InputJsonValue,
        subtitleCues: subtitleCues as unknown as Prisma.InputJsonValue,
        idempotencyKey: `${payload.episodeId}:audio-mix:1`,
      },
      update: {
        status: 'READY',
        cueSheet: cueSheet as unknown as Prisma.InputJsonValue,
        subtitleCues: subtitleCues as unknown as Prisma.InputJsonValue,
      },
    });

    await this.completeStage(run.id, 'AUDIO_MIX' as SeriesProductionStageName);
    await this.enqueueAdvance(
      payload.userId,
      payload.seriesId,
      payload.episodeId,
      'advance',
      stagePollDelayMs(500, false),
      run.id,
      payload.useMockAi,
    );
    return { completed: true, stage: 'AUDIO_MIX', cues: cueSheet.length };
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
    const dialogueDriven = priorMeta.dialogueDriven === true;
    const next = dialogueDriven
      ? nextSeriesDialogueProductionStage(stage as SeriesDialogueProductionStageName)
      : nextSeriesProductionStage(stage as SeriesProductionStageName);
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
