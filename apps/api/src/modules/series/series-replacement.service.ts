import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesApprovalStatus,
  SeriesReplacementStatus,
  StorySeriesStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  SERIES_NOTIFICATION_TYPES,
  bullMqJobId,
  effectiveAutomaticReplacementApproval,
  seriesReplacementIdempotencyKey,
  shouldAutoActivateReplacement,
  shouldTriggerReplacement,
  type SeriesReplacementPlanningPayload,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MovieArchitectService } from './movie-architect.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLaneService } from './series-lane.service';

@Injectable()
export class SeriesReplacementService {
  private readonly logger = new Logger(SeriesReplacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly architect: MovieArchitectService,
    private readonly configService: SeriesConfigService,
    private readonly lanes: SeriesLaneService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForLane(userId: string, laneId: string) {
    await this.lanes.getOwned(userId, laneId);
    return this.prisma.seriesReplacementPlan.findMany({
      where: { userId, laneId },
      include: {
        sourceSeries: { select: { id: true, title: true, status: true } },
        proposedSeries: { select: { id: true, title: true, status: true, approvalStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Enqueue or run replacement planning. Idempotent per (lane, sourceSeries) while open.
   */
  async requestReplacement(
    userId: string,
    laneId: string,
    options?: {
      sourceSeriesId?: string;
      mode?: 'threshold' | 'manual' | 'recover';
      async?: boolean;
      useMockAi?: boolean;
      force?: boolean;
    },
  ) {
    const lane = await this.lanes.getOwned(userId, laneId);
    const sourceSeriesId = options?.sourceSeriesId ?? lane.activeSeriesId;
    if (!sourceSeriesId) {
      throw new BadRequestException('Lane has no active series to replace');
    }

    const source = await this.prisma.storySeries.findFirst({
      where: { id: sourceSeriesId, userId, laneId },
    });
    if (!source) throw new NotFoundException('Source series not found on this lane');

    const idempotencyKey = seriesReplacementIdempotencyKey(laneId, sourceSeriesId);
    const existing = await this.prisma.seriesReplacementPlan.findUnique({
      where: { idempotencyKey },
    });
    const openStatuses = new Set<SeriesReplacementStatus>([
      SeriesReplacementStatus.PENDING,
      SeriesReplacementStatus.PLANNING,
      SeriesReplacementStatus.EVALUATING,
      SeriesReplacementStatus.READY_FOR_REVIEW,
      SeriesReplacementStatus.APPROVED,
    ]);
    if (existing && !options?.force && openStatuses.has(existing.status)) {
      return { plan: existing, created: false, queued: false };
    }

    const plan =
      existing && options?.force
        ? await this.prisma.seriesReplacementPlan.update({
            where: { id: existing.id },
            data: {
              status: SeriesReplacementStatus.PENDING,
              approvalStatus: SeriesApprovalStatus.PENDING,
              lastError: null,
              proposedSeriesId: null,
              rejectedAt: null,
              activatedAt: null,
              approvedAt: null,
            },
          })
        : existing ??
          (await this.prisma.seriesReplacementPlan.create({
            data: {
              userId,
              laneId,
              sourceSeriesId,
              triggerEpisode: lane.replacementTriggerEpisode,
              status: SeriesReplacementStatus.PENDING,
              idempotencyKey,
              readiness: {},
            },
          }));

    if (options?.async !== false) {
      const payload: SeriesReplacementPlanningPayload = {
        userId,
        laneId,
        sourceSeriesId,
        replacementPlanId: plan.id,
        mode: options?.mode ?? 'manual',
        useMockAi: options?.useMockAi,
        force: options?.force,
      };
      await this.queues.getQueue(QUEUE_NAMES.SERIES_REPLACEMENT_PLANNING).add(
        'plan_replacement',
        payload,
        { jobId: bullMqJobId('series-replace-job', plan.id) },
      );
      return { plan, created: !existing || Boolean(options?.force), queued: true };
    }

    const executed = await this.executePlanning(userId, plan.id, {
      useMockAi: options?.useMockAi,
    });
    return { plan: executed, created: true, queued: false };
  }

  async executePlanning(
    userId: string,
    planId: string,
    options?: { useMockAi?: boolean },
  ) {
    const plan = await this.prisma.seriesReplacementPlan.findFirst({
      where: { id: planId, userId },
      include: { lane: true, sourceSeries: true },
    });
    if (!plan) throw new NotFoundException('Replacement plan not found');

    const config = await this.configService.getOrCreate(userId);
    if (!config.automaticReplacementPlanning && plan.status === SeriesReplacementStatus.PENDING) {
      // Manual request still allowed; automatic threshold path checks this in scheduler.
    }

    await this.prisma.seriesReplacementPlan.update({
      where: { id: planId },
      data: { status: SeriesReplacementStatus.PLANNING, lastError: null },
    });

    try {
      const generated = await this.architect.planAndPersist(userId, {
        laneId: plan.laneId,
        plannedEpisodeCount: plan.lane.plannedEpisodeCount,
        targetEpisodeDurationSeconds: plan.lane.targetEpisodeDurationSeconds,
        theme: `Replacement after "${plan.sourceSeries.title}"`,
        additionalInstructions: `Create a new original movie for the ${plan.lane.laneType} lane. Do not continue the previous movie "${plan.sourceSeries.title}".`,
        asReplacementCandidate: true,
        setAsActive: false,
        useMockAi: options?.useMockAi,
        async: false,
      });

      const proposedSeriesId = (generated as { id: string }).id;
      const qualityScores = (generated as { qualityScores?: unknown }).qualityScores;

      let updated = await this.prisma.seriesReplacementPlan.update({
        where: { id: planId },
        data: {
          proposedSeriesId,
          status: SeriesReplacementStatus.READY_FOR_REVIEW,
          qualityScores: (qualityScores ?? {}) as Prisma.InputJsonValue,
          readiness: {
            bible: true,
            characters: true,
            episodeOutlines: true,
            readyForReview: true,
          },
        },
        include: {
          proposedSeries: true,
          sourceSeries: { select: { id: true, title: true } },
        },
      });

      await this.notifications.notify({
        userId,
        type: SERIES_NOTIFICATION_TYPES.REPLACEMENT_READY,
        title: 'Replacement movie ready for review',
        body: `"${updated.proposedSeries?.title ?? 'Next movie'}" is ready to review for the ${plan.lane.laneType} lane.`,
        dedupeKey: `series-replace-ready:${planId}`,
        metadata: { planId, laneId: plan.laneId, proposedSeriesId },
      });

      if (effectiveAutomaticReplacementApproval(config)) {
        updated = await this.approve(userId, planId, {
          activate: shouldAutoActivateReplacement(config),
        });
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Replacement planning failed plan=${planId}: ${message}`);
      return this.prisma.seriesReplacementPlan.update({
        where: { id: planId },
        data: {
          status: SeriesReplacementStatus.FAILED,
          lastError: message,
        },
      });
    }
  }

  async approve(
    userId: string,
    planId: string,
    options?: { activate?: boolean },
  ) {
    const plan = await this.prisma.seriesReplacementPlan.findFirst({
      where: { id: planId, userId },
      include: { proposedSeries: true, lane: true },
    });
    if (!plan) throw new NotFoundException('Replacement plan not found');
    if (!plan.proposedSeriesId) {
      throw new BadRequestException('Replacement plan has no proposed series yet');
    }
    const approvable = new Set<SeriesReplacementStatus>([
      SeriesReplacementStatus.READY_FOR_REVIEW,
      SeriesReplacementStatus.APPROVED,
    ]);
    if (!approvable.has(plan.status)) {
      throw new BadRequestException(`Cannot approve plan in status ${plan.status}`);
    }

    await this.prisma.storySeries.update({
      where: { id: plan.proposedSeriesId },
      data: {
        approvalStatus: SeriesApprovalStatus.APPROVED,
        approvedAt: new Date(),
        status: StorySeriesStatus.READY,
      },
    });

    const updated = await this.prisma.seriesReplacementPlan.update({
      where: { id: planId },
      data: {
        status: SeriesReplacementStatus.APPROVED,
        approvalStatus: SeriesApprovalStatus.APPROVED,
        approvedAt: new Date(),
      },
      include: { proposedSeries: true, sourceSeries: true },
    });

    if (options?.activate) {
      return this.activate(userId, planId);
    }
    return updated;
  }

  /**
   * Activate approved replacement as the lane's active series.
   * Does not interrupt the current series until explicitly activated
   * (typically when the current series completes / after final publish).
   */
  async activate(userId: string, planId: string) {
    const plan = await this.prisma.seriesReplacementPlan.findFirst({
      where: { id: planId, userId },
      include: { lane: true, proposedSeries: true, sourceSeries: true },
    });
    if (!plan) throw new NotFoundException('Replacement plan not found');
    if (plan.approvalStatus !== SeriesApprovalStatus.APPROVED || !plan.proposedSeriesId) {
      throw new BadRequestException('Replacement must be approved before activation');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (plan.sourceSeriesId) {
        await tx.storySeries.update({
          where: { id: plan.sourceSeriesId },
          data: {
            status: StorySeriesStatus.SUPERSEDED,
            completedAt: new Date(),
          },
        });
      }

      await tx.storySeries.update({
        where: { id: plan.proposedSeriesId! },
        data: {
          status: StorySeriesStatus.ACTIVE,
          activatedAt: new Date(),
          isReplacementCandidate: false,
        },
      });

      await tx.seriesLane.update({
        where: { id: plan.laneId },
        data: {
          activeSeriesId: plan.proposedSeriesId,
          currentEpisodeNumber: 0,
          lastPublishedEpisodeNumber: 0,
        },
      });

      return tx.seriesReplacementPlan.update({
        where: { id: planId },
        data: {
          status: SeriesReplacementStatus.ACTIVATED,
          activatedAt: new Date(),
        },
        include: { proposedSeries: true, sourceSeries: true },
      });
    });

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.replacement.activated',
        entityType: 'SeriesReplacementPlan',
        entityId: planId,
        after: {
          proposedSeriesId: plan.proposedSeriesId,
          laneId: plan.laneId,
        },
      },
    });

    return result;
  }

  async reject(userId: string, planId: string, reason?: string) {
    const plan = await this.prisma.seriesReplacementPlan.findFirst({
      where: { id: planId, userId },
    });
    if (!plan) throw new NotFoundException('Replacement plan not found');

    return this.prisma.seriesReplacementPlan.update({
      where: { id: planId },
      data: {
        status: SeriesReplacementStatus.REJECTED,
        approvalStatus: SeriesApprovalStatus.REJECTED,
        rejectedAt: new Date(),
        reviewNotes: reason ?? null,
      },
    });
  }

  async maybeEnqueueThresholdReplacement(userId: string, laneId: string) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled || !config.automaticReplacementPlanning) {
      return null;
    }
    if (!this.configService.canScheduleNewWork(config)) return null;

    const lane = await this.lanes.getOwned(userId, laneId);
    if (!this.lanes.canLaneAcceptWork(lane)) return null;
    if (!lane.activeSeriesId) return null;

    if (
      !shouldTriggerReplacement({
        lastPublishedEpisodeNumber: lane.lastPublishedEpisodeNumber,
        replacementTriggerEpisode: lane.replacementTriggerEpisode,
        plannedEpisodeCount: lane.plannedEpisodeCount,
      })
    ) {
      return null;
    }

    return this.requestReplacement(userId, laneId, {
      sourceSeriesId: lane.activeSeriesId,
      mode: 'threshold',
      async: true,
      useMockAi: process.env.GEMINI_USE_MOCK === 'true',
    });
  }
}
