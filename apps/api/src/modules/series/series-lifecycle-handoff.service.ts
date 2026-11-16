import { Injectable, Logger } from '@nestjs/common';
import {
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  bullMqJobId,
  isFullyAutonomous,
  isLaneProductionEligible,
  isSeriesStageAutoEnabled,
  type SeriesProductionStartModeName,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { CharacterDirectorService } from './character-director.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';

/**
 * Cross-stage automatic transitions after approvals / render completion.
 * Respects master + stage switches, production windows, and never bypasses disabled stages.
 */
@Injectable()
export class SeriesLifecycleHandoffService {
  private readonly logger = new Logger(SeriesLifecycleHandoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly configService: SeriesConfigService,
    private readonly characters: CharacterDirectorService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
  ) {}

  async afterMovieApproved(userId: string, seriesId: string) {
    const config = await this.configService.getOrCreate(userId);
    if (!this.configService.canScheduleNewWork(config)) {
      return { skipped: true, reason: 'series_paused_or_disabled' as const };
    }

    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      include: {
        lane: true,
        characters: { select: { id: true }, take: 1 },
      },
    });
    if (!series?.lane) {
      return { skipped: true, reason: 'series_not_found' as const };
    }

    const outcomes: Record<string, unknown> = {};

    if (config.automaticCharacterGeneration && series.characters.length > 0) {
      try {
        outcomes.characters = await this.characters.generateReferencesForSeries(
          userId,
          seriesId,
        );
      } catch (error) {
        this.logger.warn(
          `Post-approve character refs failed series=${seriesId}: ${(error as Error).message}`,
        );
        outcomes.charactersError = (error as Error).message;
      }
    }

    if (
      this.isProductionEligible(series.lane, config.autonomyMode) &&
      isSeriesStageAutoEnabled(
        config.automaticEpisodeProduction,
        config.automaticEpisodeScriptGeneration,
      )
    ) {
      outcomes.script = await this.enqueueNextScript(userId, seriesId);
    } else {
      outcomes.script = {
        skipped: true,
        reason: 'script_auto_not_eligible',
      };
    }

    return { ok: true, ...outcomes };
  }

  async afterEpisodeApproved(userId: string, seriesId: string, episodeId: string) {
    const config = await this.configService.getOrCreate(userId);
    if (!this.configService.canScheduleNewWork(config)) {
      return { skipped: true, reason: 'series_paused_or_disabled' as const };
    }

    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      include: { series: { include: { lane: true } } },
    });
    if (!episode?.series.lane) {
      return { skipped: true, reason: 'episode_not_found' as const };
    }

    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: { blockedReason: null },
    });

    const anyMedia =
      config.automaticVisualGeneration ||
      config.automaticMotionGeneration ||
      config.automaticNarration ||
      config.automaticRendering;

    if (
      !config.automaticEpisodeProduction ||
      !anyMedia ||
      !this.isProductionEligible(episode.series.lane, config.autonomyMode)
    ) {
      return {
        skipped: true,
        reason: 'production_auto_not_eligible',
        waitingFor:
          !isFullyAutonomous(config) && episode.series.lane.productionStartMode === 'MANUAL'
            ? 'manual_produce'
            : 'production_window_or_stage_switches',
      };
    }

    if (
      episode.productionState === SeriesEpisodeProductionState.QUEUED ||
      episode.productionState === SeriesEpisodeProductionState.RUNNING
    ) {
      return { skipped: true, reason: 'already_producing' as const };
    }

    const jobId = bullMqJobId('series-prod-auto', episodeId);
    await this.queues.getQueue(QUEUE_NAMES.SERIES_EPISODE_PRODUCTION).add(
      'start',
      {
        userId,
        seriesId,
        episodeId,
        action: 'start' as const,
        useMockAi: process.env.GEMINI_USE_MOCK === 'true',
      },
      { jobId },
    );
    this.logger.debug(`Handoff enqueued production episode=${episodeId}`);
    return { queued: true, jobId };
  }

  async afterEpisodeRendered(userId: string, seriesId: string, episodeId: string) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.automaticPublishing || !this.configService.canScheduleNewWork(config)) {
      return {
        skipped: true,
        reason: config.automaticPublishing
          ? 'series_paused_or_disabled'
          : 'automaticPublishing_disabled',
      };
    }

    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { laneId: true },
    });
    if (!series) {
      return { skipped: true, reason: 'series_not_found' as const };
    }

    // Prefer scheduling for the rendered episode at the next publish slot (may wait until due).
    const result = await this.publishScheduler.ensureNextSchedule(userId, series.laneId);
    this.logger.debug(
      `Handoff ensure schedule after render episode=${episodeId} result=${JSON.stringify(result)}`,
    );
    return result;
  }

  private isProductionEligible(
    lane: {
      timezone: string;
      publishTime: string;
      productionLeadTimeMinutes: number;
      preferredProductionTime: string | null;
      productionStartMode: string;
      customProductionStartAt: Date | null;
    },
    autonomyMode?: string,
  ) {
    // Fully autonomous never waits on MANUAL production start mode.
    const productionStartMode =
      isFullyAutonomous({ autonomyMode }) && lane.productionStartMode === 'MANUAL'
        ? 'NEXT_WINDOW'
        : (lane.productionStartMode as SeriesProductionStartModeName);

    return isLaneProductionEligible({
      now: new Date(),
      timeZone: lane.timezone,
      publishTime: lane.publishTime,
      leadTimeMinutes: lane.productionLeadTimeMinutes,
      preferredProductionTime: lane.preferredProductionTime,
      productionStartMode,
      customProductionStartAt: lane.customProductionStartAt,
    });
  }

  private async enqueueNextScript(userId: string, seriesId: string) {
    const next = await this.prisma.seriesEpisode.findFirst({
      where: {
        seriesId,
        status: SeriesEpisodeStatus.PLANNED,
        script: null,
      },
      orderBy: { episodeNumber: 'asc' },
    });
    if (!next) return { skipped: true, reason: 'no_planned_episode' as const };

    const jobId = bullMqJobId('series-ep-auto', next.id);
    await this.queues.getQueue(QUEUE_NAMES.SERIES_EPISODE_PLANNING).add(
      'plan_episode',
      {
        userId,
        seriesId,
        episodeId: next.id,
        useMockAi: process.env.GEMINI_USE_MOCK === 'true',
      },
      { jobId },
    );
    return { queued: true, jobId, episodeId: next.id };
  }
}
