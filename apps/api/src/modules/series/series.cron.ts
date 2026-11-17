import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  QUEUE_NAMES,
  SERIES_NOTIFICATION_TYPES,
  bullMqJobId,
  computeNextProductionAt,
  computeNextPublishAt,
  effectiveMovieApprovalRequired,
  isLaneProductionEligible,
  isLanePublishDue,
  isSeriesStageAutoEnabled,
  seriesMaintenanceJobId,
  utcMinuteKey,
  type SeriesProductionStartModeName,
} from '@ai-video/shared';
import {
  SeriesApprovalStatus,
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesExecutionAction,
  SeriesExecutionStatus,
  SeriesExecutionTrigger,
} from '@prisma/client';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { AutomationBudgetService } from '../automation/automation-budget.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';
import { SeriesReplacementService } from './series-replacement.service';

/**
 * Series Studio scheduler tick is enqueue-only.
 * Side effects run in SeriesQueueHost workers (single-owner via PROCESS_ROLE + Redis lock).
 */
@Injectable()
export class SeriesCronService {
  private readonly logger = new Logger(SeriesCronService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService,
    private readonly configService: SeriesConfigService,
    private readonly lanes: SeriesLaneService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
    private readonly replacements: SeriesReplacementService,
    private readonly budgets: AutomationBudgetService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!shouldRunSchedulers()) return;
    if (process.env.SERIES_CRON_DISABLED === 'true') return;
    if (this.ticking) return;
    this.ticking = true;
    try {
      const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 55);
      const { acquired } = await this.locks.withLock('cron:series', ttl, () => this.runTick());
      if (!acquired) {
        this.logger.debug('Series cron lock not acquired — skipping duplicate tick');
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runTick() {
    const now = new Date();
    const emergency = await this.prisma.setting.findUnique({
      where: { key: 'system:automation:emergencyStop' },
    });
    const emergencyActive =
      emergency &&
      typeof emergency.value === 'object' &&
      emergency.value !== null &&
      (emergency.value as { active?: boolean }).active === true;
    if (emergencyActive) {
      this.logger.debug('Global emergency stop — Series scheduler skips new work');
      await this.enqueueMaintenance('recover_stuck');
      return;
    }

    await this.enqueueMaintenance('recover_stuck');
    await this.enqueueMaintenance('missed_schedules');

    await this.queues.getQueue(QUEUE_NAMES.SERIES_PUBLISHING).add(
      'tick',
      { mode: 'tick' },
      { jobId: bullMqJobId('series-pub-tick', utcMinuteKey(now)) },
    );

    const configs = await this.prisma.seriesAutomationConfig.findMany({
      where: { seriesStudioEnabled: true, runMode: 'ENABLED' },
      take: 100,
    });

    for (const raw of configs) {
      const config = this.configService.serialize(raw);
      if (!this.configService.canScheduleNewWork(config)) continue;

      const userLanes = await this.prisma.seriesLane.findMany({
        where: { userId: config.userId, deletedAt: null },
      });

      for (const lane of userLanes) {
        if (lane.deletedAt) continue;
        const laneEnabled = this.lanes.isLaneConfigEnabled(lane, config);
        if (!laneEnabled) continue;
        if (!this.lanes.canLaneAcceptWork(lane)) continue;

        // Never pull a reserved future nextPublishAt backward — that caused same-day
        // multi-episode publishes when produce-ahead finished early.
        const computedPublishAt = computeNextPublishAt(now, lane.timezone, lane.publishTime);
        const nextPublishAt =
          lane.nextPublishAt && lane.nextPublishAt.getTime() > now.getTime()
            ? lane.nextPublishAt
            : computedPublishAt;
        const nextProductionAt = computeNextProductionAt(
          now,
          lane.timezone,
          lane.publishTime,
          lane.productionLeadTimeMinutes,
          lane.preferredProductionTime,
        );

        const publishAnchorNeedsRefresh =
          !lane.nextPublishAt || lane.nextPublishAt.getTime() <= now.getTime();
        const productionAnchorStale =
          !lane.nextProductionAt ||
          Math.abs(lane.nextProductionAt.getTime() - nextProductionAt.getTime()) > 60_000;

        if (publishAnchorNeedsRefresh || productionAnchorStale) {
          await this.prisma.seriesLane.update({
            where: { id: lane.id },
            data: {
              ...(publishAnchorNeedsRefresh ? { nextPublishAt } : {}),
              ...(productionAnchorStale ? { nextProductionAt } : {}),
            },
          });
        }

        const budget = await this.budgets.assertBudgetAllows({
          userId: config.userId,
          timeZone: lane.timezone,
          dailyBudgetUsd: config.dailyBudgetUsd,
          monthlyBudgetUsd: config.monthlyBudgetUsd,
          maxCostPerVideoUsd: config.maxCostPerEpisodeUsd,
        });
        if (!budget.allowed) {
          await this.notifications.notify({
            userId: config.userId,
            type: SERIES_NOTIFICATION_TYPES.BUDGET_REACHED,
            title: 'Series budget limit reached',
            body: budget.reason ?? 'Budget limit reached',
            dedupeKey: `series-budget:${config.userId}:${now.toISOString().slice(0, 10)}`,
            metadata: { laneId: lane.id },
          });
          continue;
        }

        const due = isLanePublishDue(now, lane.timezone, lane.publishTime);
        if (due && config.automaticPublishing) {
          await this.publishScheduler.ensureNextSchedule(config.userId, lane.id);
        }

        if (config.automaticMoviePlanning && !lane.activeSeriesId) {
          await this.enqueueMoviePlanning(config.userId, lane.id);
        }

        const productionEligible = isLaneProductionEligible({
          now,
          timeZone: lane.timezone,
          publishTime: lane.publishTime,
          leadTimeMinutes: lane.productionLeadTimeMinutes,
          preferredProductionTime: lane.preferredProductionTime,
          productionStartMode: lane.productionStartMode as SeriesProductionStartModeName,
          customProductionStartAt: lane.customProductionStartAt,
        });

        if (
          productionEligible &&
          isSeriesStageAutoEnabled(
            config.automaticEpisodeProduction,
            config.automaticEpisodeScriptGeneration,
          ) &&
          lane.activeSeriesId
        ) {
          await this.enqueueNextEpisodeScript(
            config.userId,
            lane.id,
            lane.activeSeriesId,
            config,
          );
        }

        const anyMediaStage =
          config.automaticVisualGeneration ||
          config.automaticMotionGeneration ||
          config.automaticNarration ||
          config.automaticRendering;

        if (
          productionEligible &&
          config.automaticEpisodeProduction &&
          anyMediaStage &&
          lane.activeSeriesId
        ) {
          await this.enqueueNextEpisodeProduction(
            config.userId,
            lane.id,
            lane.activeSeriesId,
            config,
          );
        }

        if (config.automaticReplacementPlanning) {
          await this.replacements.maybeEnqueueThresholdReplacement(config.userId, lane.id);
        }
      }
    }
  }

  private async enqueueMoviePlanning(userId: string, laneId: string) {
    const jobId = bullMqJobId('series-movie-auto', laneId);
    await this.queues.getQueue(QUEUE_NAMES.SERIES_STORY_PLANNING).add(
      'plan_movie',
      {
        userId,
        laneId,
        useMockAi: process.env.GEMINI_USE_MOCK === 'true',
        request: {
          laneId,
          useMockAi: process.env.GEMINI_USE_MOCK === 'true',
          setAsActive: true,
          asReplacementCandidate: false,
          async: false,
        },
      },
      { jobId },
    );
    await this.recordScheduledExecution(userId, laneId, SeriesExecutionAction.PLAN_MOVIE, {
      jobId,
    });
    this.logger.debug(`Enqueued automatic movie planning lane=${laneId}`);
  }

  private async enqueueNextEpisodeScript(
    userId: string,
    laneId: string,
    seriesId: string,
    config: {
      maxConcurrentEpisodeProduction: number;
      autonomyMode?: string;
      movieApprovalRequired?: boolean;
      effectiveMovieApprovalRequired?: boolean;
    },
  ) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { approvalStatus: true },
    });
    if (!series) return;

    const needsMovieApproval =
      config.effectiveMovieApprovalRequired ?? effectiveMovieApprovalRequired(config);
    if (
      needsMovieApproval &&
      series.approvalStatus !== SeriesApprovalStatus.APPROVED
    ) {
      return;
    }

    const running = await this.prisma.seriesEpisode.count({
      where: {
        seriesId,
        status: { in: [SeriesEpisodeStatus.SCRIPTING, SeriesEpisodeStatus.PRODUCING] },
      },
    });
    if (running >= config.maxConcurrentEpisodeProduction) return;

    const next = await this.prisma.seriesEpisode.findFirst({
      where: {
        seriesId,
        status: SeriesEpisodeStatus.PLANNED,
        script: null,
      },
      orderBy: { episodeNumber: 'asc' },
    });
    if (!next) return;

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
    await this.recordScheduledExecution(
      userId,
      laneId,
      SeriesExecutionAction.PLAN_EPISODE,
      { jobId, seriesId, episodeId: next.id },
    );
    this.logger.debug(`Enqueued episode planning lane=${laneId} episode=${next.episodeNumber}`);
  }

  private async enqueueNextEpisodeProduction(
    userId: string,
    laneId: string,
    seriesId: string,
    config: { maxConcurrentEpisodeProduction: number },
  ) {
    const running = await this.prisma.seriesEpisode.count({
      where: {
        series: { userId },
        productionState: {
          in: [SeriesEpisodeProductionState.QUEUED, SeriesEpisodeProductionState.RUNNING],
        },
      },
    });
    if (running >= config.maxConcurrentEpisodeProduction) return;

    const next = await this.prisma.seriesEpisode.findFirst({
      where: {
        seriesId,
        status: SeriesEpisodeStatus.APPROVED,
        productionState: SeriesEpisodeProductionState.IDLE,
        approvalStatus: 'APPROVED',
      },
      orderBy: { episodeNumber: 'asc' },
    });
    if (!next) return;

    // Do not auto-start if a stage gate previously blocked this episode.
    if (next.blockedReason?.includes('disabled')) {
      return;
    }

    const jobId = bullMqJobId('series-prod-auto', next.id);
    await this.queues.getQueue(QUEUE_NAMES.SERIES_EPISODE_PRODUCTION).add(
      'start',
      {
        userId,
        seriesId,
        episodeId: next.id,
        action: 'start' as const,
        useMockAi: process.env.GEMINI_USE_MOCK === 'true',
      },
      { jobId },
    );
    await this.recordScheduledExecution(
      userId,
      laneId,
      SeriesExecutionAction.PRODUCE_EPISODE,
      { jobId, seriesId, episodeId: next.id },
    );
    this.logger.debug(
      `Enqueued episode production lane=${laneId} episode=${next.episodeNumber}`,
    );
  }

  private async recordScheduledExecution(
    userId: string,
    laneId: string,
    action: SeriesExecutionAction,
    meta: { jobId: string; seriesId?: string; episodeId?: string },
  ) {
    try {
      await this.prisma.seriesExecution.create({
        data: {
          userId,
          laneId,
          triggerSource: SeriesExecutionTrigger.SCHEDULED,
          requestedAction: action,
          resolvedAction: action,
          status: SeriesExecutionStatus.QUEUED,
          seriesId: meta.seriesId,
          episodeId: meta.episodeId,
          queueJobIds: [meta.jobId],
          idempotencyKey: `sched:${meta.jobId}`,
          startedAt: new Date(),
          resultSummary: { source: 'series.cron' },
        },
      });
    } catch {
      // Idempotent job ids may retry the same minute — ignore duplicate execution rows.
    }
  }

  private async enqueueMaintenance(mode: 'recover_stuck' | 'missed_schedules') {
    await this.queues.getQueue(QUEUE_NAMES.SERIES_MAINTENANCE).add(
      mode,
      { mode },
      { jobId: seriesMaintenanceJobId(mode, utcMinuteKey()) },
    );
  }
}
