import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PublishStatus,
  SeriesEpisodeApprovalStatus,
  SeriesEpisodeStatus,
  SeriesScheduleState,
  SocialConnectionStatus,
  SocialPlatform,
  VideoRenderStatus,
} from '@prisma/client';
import {
  DEFAULT_CAPABILITIES,
  QUEUE_NAMES,
  SERIES_NOTIFICATION_TYPES,
  buildSeriesEpisodePostCaption,
  buildSeriesEpisodePostTitle,
  buildViralHashtags,
  computeNextPublishAt,
  seriesPublishJobId,
  seriesScheduleIdempotencyKey,
  type PublishingCapabilities,
  type SeriesPublishingPayload,
  type SocialPlatformKey,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PublishingService } from '../publishing/publishing.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesReplacementService } from './series-replacement.service';

const TERMINAL_PUBLISH_STATUSES: PublishStatus[] = [
  PublishStatus.PUBLISHED,
  PublishStatus.FAILED,
  PublishStatus.CANCELLED,
];

/**
 * Idempotent Series schedule creation + due enqueue + live social handoff
 * via existing PublishingService / social-* worker queues.
 */
@Injectable()
export class SeriesPublishSchedulerService {
  private readonly logger = new Logger(SeriesPublishSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly publishingService: PublishingService,
    private readonly configService: SeriesConfigService,
    private readonly lanes: SeriesLaneService,
    private readonly replacements: SeriesReplacementService,
    private readonly notifications: NotificationsService,
  ) {}

  async refreshLaneNextPublishAt(laneId: string) {
    const lane = await this.prisma.seriesLane.findUniqueOrThrow({ where: { id: laneId } });
    const nextPublishAt = computeNextPublishAt(new Date(), lane.timezone, lane.publishTime);
    return this.prisma.seriesLane.update({
      where: { id: laneId },
      data: { nextPublishAt },
    });
  }

  /**
   * Ensure a unique SeriesSchedule exists for the next publishable episode on a lane.
   * Prefers RENDERED episodes with a completed render; may pre-schedule APPROVED
   * episodes that will wait for render before live social handoff.
   */
  async ensureNextSchedule(userId: string, laneId: string) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.automaticPublishing) {
      return { created: false, reason: 'automaticPublishing_disabled' as const };
    }
    if (!this.configService.canScheduleNewWork(config)) {
      return { created: false, reason: 'series_paused_or_disabled' as const };
    }

    const lane = await this.lanes.getOwned(userId, laneId);
    if (!this.lanes.canLaneAcceptWork(lane) || !lane.activeSeriesId) {
      return { created: false, reason: 'lane_not_active' as const };
    }

    const episode =
      (await this.prisma.seriesEpisode.findFirst({
        where: {
          seriesId: lane.activeSeriesId,
          publishedAt: null,
          approvalStatus: SeriesEpisodeApprovalStatus.APPROVED,
          status: SeriesEpisodeStatus.RENDERED,
          videoRenderId: { not: null },
          schedules: { none: {} },
        },
        orderBy: { episodeNumber: 'asc' },
      })) ??
      (await this.prisma.seriesEpisode.findFirst({
        where: {
          seriesId: lane.activeSeriesId,
          publishedAt: null,
          approvalStatus: SeriesEpisodeApprovalStatus.APPROVED,
          status: {
            in: [
              SeriesEpisodeStatus.APPROVED,
              SeriesEpisodeStatus.RENDERED,
              SeriesEpisodeStatus.SCHEDULED,
            ],
          },
          schedules: { none: {} },
        },
        orderBy: { episodeNumber: 'asc' },
      }));

    if (!episode) {
      await this.notifications.notify({
        userId,
        type: SERIES_NOTIFICATION_TYPES.NO_READY_EPISODE,
        title: `${lane.laneType} lane has no ready episode`,
        body: 'No approved unpublished episode is available to schedule.',
        dedupeKey: `series-no-ready:${laneId}:${new Date().toISOString().slice(0, 10)}`,
        metadata: { laneId },
      });
      return { created: false, reason: 'no_ready_episode' as const };
    }

    const scheduledAt =
      lane.nextPublishAt ??
      computeNextPublishAt(new Date(), lane.timezone, lane.publishTime);
    const idempotencyKey = seriesScheduleIdempotencyKey(laneId, episode.id);

    try {
      const schedule = await this.prisma.seriesSchedule.create({
        data: {
          userId,
          laneId,
          episodeId: episode.id,
          scheduledAt,
          state: SeriesScheduleState.SCHEDULED,
          idempotencyKey,
          publicationDestination: {
            channelIds: config.activeChannelIds,
            channelPublishingEnabled: config.channelPublishingEnabled,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.seriesEpisode.update({
        where: { id: episode.id },
        data: {
          status: SeriesEpisodeStatus.SCHEDULED,
          scheduledAt,
        },
      });

      await this.notifications.notify({
        userId,
        type: SERIES_NOTIFICATION_TYPES.EPISODE_SCHEDULED,
        title: `Episode ${episode.episodeNumber} scheduled`,
        body: `"${episode.title}" scheduled for ${scheduledAt.toISOString()} (${lane.laneType}).`,
        dedupeKey: `series-ep-scheduled:${schedule.id}`,
        metadata: { laneId, episodeId: episode.id, scheduleId: schedule.id },
      });

      return { created: true, schedule };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.seriesSchedule.findUnique({
          where: { idempotencyKey },
        });
        return { created: false, schedule: existing, reason: 'duplicate' as const };
      }
      throw error;
    }
  }

  async processDuePublications(payload: SeriesPublishingPayload = { mode: 'tick' }) {
    const outcomes = await this.reconcilePublishOutcomes(payload.userId);

    const now = new Date();
    const due = await this.prisma.seriesSchedule.findMany({
      where: {
        state: SeriesScheduleState.SCHEDULED,
        scheduledAt: { lte: now },
        ...(payload.userId ? { userId: payload.userId } : {}),
        ...(payload.seriesScheduleId ? { id: payload.seriesScheduleId } : {}),
      },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });

    let enqueued = 0;
    for (const schedule of due) {
      const jobId = seriesPublishJobId(schedule.id);
      await this.queues.getQueue(QUEUE_NAMES.SERIES_PUBLISHING).add(
        'publish',
        {
          mode: 'enqueue_one',
          userId: schedule.userId,
          seriesScheduleId: schedule.id,
          useMockSocial: payload.useMockSocial,
          force: payload.force,
        } satisfies SeriesPublishingPayload,
        { jobId },
      );
      enqueued += 1;
    }

    return { due: due.length, enqueued, outcomes };
  }

  /**
   * Claim a due schedule and hand off to PublishingService (or dry-run).
   */
  async enqueueOne(
    scheduleId: string,
    options?: { force?: boolean; useMockSocial?: boolean; userId?: string },
  ) {
    const claimed = await this.prisma.seriesSchedule.updateMany({
      where: {
        id: scheduleId,
        ...(options?.userId ? { userId: options.userId } : {}),
        state: options?.force
          ? {
              in: [
                SeriesScheduleState.SCHEDULED,
                SeriesScheduleState.FAILED,
                SeriesScheduleState.QUEUED,
              ],
            }
          : SeriesScheduleState.SCHEDULED,
      },
      data: { state: SeriesScheduleState.QUEUED },
    });
    if (claimed.count === 0) {
      return { ok: false, reason: 'not_claimable' as const };
    }

    const schedule = await this.prisma.seriesSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      include: {
        episode: {
          include: {
            story: true,
            series: {
              select: {
                title: true,
                genre: true,
                slug: true,
                plannedEpisodeCount: true,
              },
            },
          },
        },
        lane: true,
      },
    });

    const config = await this.configService.getOrCreate(schedule.userId);
    if (!config.automaticPublishing || !this.configService.canScheduleNewWork(config)) {
      await this.prisma.seriesSchedule.update({
        where: { id: scheduleId },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          lastError: 'Publishing disabled or Series Studio paused',
        },
      });
      return { ok: false, reason: 'publishing_disabled' as const };
    }

    if (!this.lanes.canLaneAcceptWork(schedule.lane)) {
      await this.prisma.seriesSchedule.update({
        where: { id: scheduleId },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          lastError: 'Lane paused',
        },
      });
      return { ok: false, reason: 'lane_paused' as const };
    }

    const dryRun =
      options?.useMockSocial === true ||
      process.env.SERIES_PUBLISH_DRY_RUN === 'true' ||
      process.env.SOCIAL_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test';

    if (!schedule.episode.videoRenderId && !dryRun) {
      await this.prisma.seriesSchedule.update({
        where: { id: scheduleId },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          lastError: 'Waiting for rendered video',
          metadata: {
            ...(typeof schedule.metadata === 'object' && schedule.metadata
              ? (schedule.metadata as object)
              : {}),
            awaitingRender: true,
          },
        },
      });
      return { ok: false, reason: 'awaiting_render' as const };
    }

    await this.prisma.seriesSchedule.update({
      where: { id: scheduleId },
      data: { state: SeriesScheduleState.PUBLISHING, lastError: null },
    });

    if (dryRun) {
      return this.completeDryRunPublish(schedule);
    }

    return this.handoffLivePublish(schedule, config);
  }

  async markMissedSchedules(now = new Date()) {
    const graceMs = 2 * 60 * 60 * 1000;
    const overdue = await this.prisma.seriesSchedule.findMany({
      where: {
        state: SeriesScheduleState.SCHEDULED,
        scheduledAt: { lt: new Date(now.getTime() - graceMs) },
      },
      include: {
        episode: { select: { id: true, status: true, videoRenderId: true } },
        lane: true,
      },
      take: 100,
    });

    let missed = 0;
    let rescheduled = 0;

    for (const row of overdue) {
      // Incomplete video: mark delayed/missed, keep producing; never publish incomplete.
      if (
        row.episode.status !== SeriesEpisodeStatus.RENDERED ||
        !row.episode.videoRenderId
      ) {
        await this.prisma.seriesSchedule.update({
          where: { id: row.id },
          data: {
            state: SeriesScheduleState.MISSED,
            lastError:
              'Publish window missed — episode was not fully rendered. Production may continue; will reschedule when ready.',
            metadata: {
              ...(typeof row.metadata === 'object' && row.metadata
                ? (row.metadata as object)
                : {}),
              missedAt: now.toISOString(),
              latePublishPolicy: 'next_window',
            } as Prisma.InputJsonValue,
          },
        });
        missed += 1;
        continue;
      }

      // Rendered but still not published within grace — roll to next publish window (same row).
      const nextAt = computeNextPublishAt(
        now,
        row.lane.timezone,
        row.lane.publishTime,
      );
      await this.prisma.seriesSchedule.update({
        where: { id: row.id },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          scheduledAt: nextAt,
          lastError: 'Missed prior window — rescheduled to next publish opportunity',
          retryCount: { increment: 1 },
          metadata: {
            ...(typeof row.metadata === 'object' && row.metadata
              ? (row.metadata as object)
              : {}),
            rescheduledFromMissed: true,
            previousScheduledAt: row.scheduledAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      await this.prisma.seriesEpisode.update({
        where: { id: row.episodeId },
        data: { scheduledAt: nextAt, status: SeriesEpisodeStatus.SCHEDULED },
      });
      rescheduled += 1;
    }

    // Recover MISSED schedules once the episode becomes RENDERED.
    const recoverable = await this.prisma.seriesSchedule.findMany({
      where: {
        state: SeriesScheduleState.MISSED,
        episode: {
          status: SeriesEpisodeStatus.RENDERED,
          videoRenderId: { not: null },
          publishedAt: null,
        },
      },
      include: { lane: true },
      take: 50,
    });
    for (const row of recoverable) {
      const nextAt = computeNextPublishAt(
        now,
        row.lane.timezone,
        row.lane.publishTime,
      );
      await this.prisma.seriesSchedule.update({
        where: { id: row.id },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          scheduledAt: nextAt,
          lastError: null,
          retryCount: { increment: 1 },
          metadata: {
            ...(typeof row.metadata === 'object' && row.metadata
              ? (row.metadata as object)
              : {}),
            recoveredFromMissed: true,
          } as Prisma.InputJsonValue,
        },
      });
      await this.prisma.seriesEpisode.update({
        where: { id: row.episodeId },
        data: { scheduledAt: nextAt, status: SeriesEpisodeStatus.SCHEDULED },
      });
      rescheduled += 1;
    }

    return { missed, rescheduled };
  }

  async reconcile(userId?: string) {
    const stuck = await this.prisma.seriesSchedule.findMany({
      where: {
        state: { in: [SeriesScheduleState.QUEUED, SeriesScheduleState.PUBLISHING] },
        updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
        ...(userId ? { userId } : {}),
        publishRecordIds: { isEmpty: true },
      },
      take: 50,
    });

    for (const row of stuck) {
      await this.prisma.seriesSchedule.update({
        where: { id: row.id },
        data: {
          state: SeriesScheduleState.FAILED,
          lastError: 'Recovered stuck publish job',
          retryCount: { increment: 1 },
        },
      });
    }

    const outcomes = await this.reconcilePublishOutcomes(userId);
    return { recovered: stuck.length, outcomes };
  }

  /**
   * Poll PublishRecord rows linked on SeriesSchedule and advance episode/lane state.
   */
  async reconcilePublishOutcomes(userId?: string) {
    const active = await this.prisma.seriesSchedule.findMany({
      where: {
        ...(userId ? { userId } : {}),
        state: SeriesScheduleState.PUBLISHING,
        NOT: { publishRecordIds: { isEmpty: true } },
      },
      include: {
        episode: true,
        lane: true,
      },
      take: 50,
    });

    let published = 0;
    let failed = 0;
    let waiting = 0;

    for (const schedule of active) {
      const records = await this.prisma.publishRecord.findMany({
        where: { id: { in: schedule.publishRecordIds } },
      });
      if (records.length === 0) {
        waiting += 1;
        continue;
      }

      const allTerminal = records.every((record) =>
        TERMINAL_PUBLISH_STATUSES.includes(record.status),
      );
      if (!allTerminal) {
        waiting += 1;
        continue;
      }

      const successes = records.filter((record) => record.status === PublishStatus.PUBLISHED);
      if (successes.length > 0) {
        await this.markSeriesPublished(schedule, {
          dryRun: false,
          publishRecordIds: schedule.publishRecordIds,
          postUrls: successes.map((record) => record.postUrl).filter(Boolean) as string[],
        });
        published += 1;
      } else {
        await this.prisma.seriesSchedule.update({
          where: { id: schedule.id },
          data: {
            state: SeriesScheduleState.FAILED,
            lastError:
              records.map((record) => record.errorMessage).find(Boolean) ??
              'All channel publishes failed',
            retryCount: { increment: 1 },
          },
        });
        await this.notifications.notify({
          userId: schedule.userId,
          type: SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED,
          title: `Episode ${schedule.episode.episodeNumber} publish failed`,
          body: `"${schedule.episode.title}" failed on all social channels.`,
          dedupeKey: `series-pub-fail:${schedule.id}`,
          metadata: { scheduleId: schedule.id },
        });
        failed += 1;
      }
    }

    return { scanned: active.length, published, failed, waiting };
  }

  private async handoffLivePublish(
    schedule: Prisma.SeriesScheduleGetPayload<{
      include: {
        episode: {
          include: {
            story: true;
            series: {
              select: {
                title: true;
                genre: true;
                slug: true;
                plannedEpisodeCount: true;
              };
            };
          };
        };
        lane: true;
      };
    }>,
    config: Awaited<ReturnType<SeriesConfigService['getOrCreate']>>,
  ) {
    const renderId = schedule.episode.videoRenderId!;
    const render = await this.prisma.videoRender.findFirst({
      where: {
        id: renderId,
        userId: schedule.userId,
        status: VideoRenderStatus.COMPLETED,
        outputMediaAssetId: { not: null },
      },
    });
    if (!render) {
      await this.prisma.seriesSchedule.update({
        where: { id: schedule.id },
        data: {
          state: SeriesScheduleState.SCHEDULED,
          lastError: 'Render is not completed/validated',
          metadata: { awaitingRender: true, videoRenderId: renderId },
        },
      });
      return { ok: false, reason: 'render_not_ready' as const };
    }

    // Resume existing in-flight publish records (idempotent reconcile path).
    if (schedule.publishRecordIds.length > 0) {
      const existing = await this.prisma.publishRecord.findMany({
        where: { id: { in: schedule.publishRecordIds } },
      });
      for (const record of existing) {
        if (record.status === PublishStatus.FAILED) {
          await this.publishingService.retry(schedule.userId, record.id).catch(() => undefined);
        }
      }
      const allPublished =
        existing.length > 0 &&
        existing.every((record) => record.status === PublishStatus.PUBLISHED);
      if (allPublished) {
        await this.markSeriesPublished(schedule, {
          dryRun: false,
          publishRecordIds: schedule.publishRecordIds,
        });
        return { ok: true, reason: 'already_published' as const };
      }
      return {
        ok: true,
        reason: 'awaiting_provider' as const,
        publishRecordIds: schedule.publishRecordIds,
      };
    }

    const destination = (schedule.publicationDestination ?? {}) as {
      channelIds?: string[];
      channelPublishingEnabled?: Record<string, boolean>;
    };
    const enabledMap =
      destination.channelPublishingEnabled ??
      (config.channelPublishingEnabled as Record<string, boolean>) ??
      {};
    const activeChannelIds =
      destination.channelIds?.length ? destination.channelIds : config.activeChannelIds;

    const channels = await this.prisma.socialChannel.findMany({
      where: {
        userId: schedule.userId,
        isActive: true,
        ...(activeChannelIds.length ? { id: { in: activeChannelIds } } : {}),
      },
    });

    const eligible = channels.filter((channel) => {
      if (enabledMap[channel.platform] === false) return false;
      return this.evaluateEligibility(channel).ok;
    });

    if (eligible.length === 0) {
      await this.prisma.seriesSchedule.update({
        where: { id: schedule.id },
        data: {
          state: SeriesScheduleState.FAILED,
          lastError: 'No eligible social channels for series publish',
          retryCount: { increment: 1 },
        },
      });
      await this.notifications.notify({
        userId: schedule.userId,
        type: SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED,
        title: 'Series publish blocked — no eligible channels',
        body: `Episode ${schedule.episode.episodeNumber} has no active publishable channels.`,
        dedupeKey: `series-pub-no-channel:${schedule.id}`,
      });
      return { ok: false, reason: 'no_eligible_channels' as const };
    }

    const story = schedule.episode.story;
    const series = schedule.episode.series;
    const slotKind =
      schedule.lane.laneType === 'MORNING'
        ? 'morning'
        : schedule.lane.laneType === 'EVENING'
          ? 'evening'
          : null;

    const postTitle = buildSeriesEpisodePostTitle({
      episodeNumber: schedule.episode.episodeNumber,
      episodeTitle: schedule.episode.title,
      plannedEpisodeCount: series.plannedEpisodeCount,
    });
    const captionBody =
      story?.description?.trim() ||
      schedule.episode.synopsis?.trim() ||
      story?.openingHook?.trim() ||
      schedule.episode.hook?.trim() ||
      '';
    const caption = buildSeriesEpisodePostCaption({
      seriesTitle: series.title,
      episodeNumber: schedule.episode.episodeNumber,
      episodeTitle: schedule.episode.title,
      plannedEpisodeCount: series.plannedEpisodeCount,
      body: captionBody,
    });

    const targets = eligible.map((channel) => {
      const hashtags = buildViralHashtags({
        platform: channel.platform,
        seedTags: story?.hashtags?.length
          ? story.hashtags
          : ['series', series.slug],
        category: series.genre ?? undefined,
        theme: series.title,
        title: postTitle,
        slotKind,
      });
      return {
        channelId: channel.id,
        title: postTitle,
        caption,
        description: caption,
        hashtags,
      };
    });

    try {
      const publications = await this.publishingService.publishRender(
        schedule.userId,
        renderId,
        {
          targets,
          idempotencyKey: `series-pub:${schedule.id}`,
        },
      );
      const publishRecordIds = publications.map((publication) => publication.id);

      await this.prisma.seriesSchedule.update({
        where: { id: schedule.id },
        data: {
          state: SeriesScheduleState.PUBLISHING,
          publishRecordIds,
          metadata: {
            liveHandoffAt: new Date().toISOString(),
            videoRenderId: renderId,
            channelCount: publishRecordIds.length,
          },
        },
      });

      this.logger.log(
        `Series live publish handed off schedule=${schedule.id} records=${publishRecordIds.length}`,
      );
      return {
        ok: true,
        reason: 'live_handoff' as const,
        publishRecordIds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.seriesSchedule.update({
        where: { id: schedule.id },
        data: {
          state: SeriesScheduleState.FAILED,
          lastError: message,
          retryCount: { increment: 1 },
        },
      });
      throw error;
    }
  }

  private async completeDryRunPublish(
    schedule: Prisma.SeriesScheduleGetPayload<{
      include: { episode: true; lane: true };
    }>,
  ) {
    await this.markSeriesPublished(schedule, { dryRun: true, publishRecordIds: [] });
    this.logger.log(`Series dry-run publish schedule=${schedule.id}`);
    return { ok: true, reason: 'dry_run_published' as const };
  }

  private async markSeriesPublished(
    schedule: {
      id: string;
      userId: string;
      laneId: string;
      episodeId: string;
      episode: { episodeNumber: number; title: string };
      lane: { timezone: string; publishTime: string };
    },
    options: {
      dryRun: boolean;
      publishRecordIds: string[];
      postUrls?: string[];
    },
  ) {
    const publishedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.seriesSchedule.update({
        where: { id: schedule.id },
        data: {
          state: SeriesScheduleState.PUBLISHED,
          publishedAt,
          lastError: null,
          publishRecordIds: options.publishRecordIds,
          metadata: {
            dryRun: options.dryRun,
            ...(options.postUrls?.length ? { postUrls: options.postUrls } : {}),
          },
        },
      });
      await tx.seriesEpisode.update({
        where: { id: schedule.episodeId },
        data: {
          status: SeriesEpisodeStatus.PUBLISHED,
          publishedAt,
        },
      });
      await tx.seriesLane.update({
        where: { id: schedule.laneId },
        data: {
          lastPublishedEpisodeNumber: schedule.episode.episodeNumber,
          lastPublishedAt: publishedAt,
          currentEpisodeNumber: schedule.episode.episodeNumber,
          nextPublishAt: computeNextPublishAt(
            publishedAt,
            schedule.lane.timezone,
            schedule.lane.publishTime,
          ),
        },
      });
    });

    await this.notifications.notify({
      userId: schedule.userId,
      type: SERIES_NOTIFICATION_TYPES.EPISODE_PUBLISHED,
      title: options.dryRun
        ? `Episode ${schedule.episode.episodeNumber} published (dry-run)`
        : `Episode ${schedule.episode.episodeNumber} published`,
      body: options.dryRun
        ? `"${schedule.episode.title}" marked published for scheduler testing.`
        : `"${schedule.episode.title}" published to social channels.`,
      dedupeKey: `series-ep-published:${schedule.id}`,
      metadata: {
        scheduleId: schedule.id,
        dryRun: options.dryRun,
        publishRecordIds: options.publishRecordIds,
      },
    });

    await this.replacements.maybeEnqueueThresholdReplacement(
      schedule.userId,
      schedule.laneId,
    );
    await this.maybeActivateReadyReplacement(schedule.userId, schedule.laneId);
  }

  private evaluateEligibility(channel: {
    id: string;
    isActive: boolean;
    connectionStatus: SocialConnectionStatus;
    platform: SocialPlatform;
    publishingCapabilities: Prisma.JsonValue;
  }): { ok: boolean; reason?: string } {
    if (!channel.isActive) return { ok: false, reason: 'Channel inactive' };
    const caps = this.parseCapabilities(channel);
    const eligibleStatus =
      channel.connectionStatus === SocialConnectionStatus.PUBLIC_READY ||
      channel.connectionStatus === SocialConnectionStatus.TEST_ONLY ||
      (channel.connectionStatus === SocialConnectionStatus.CONNECTED && caps.canPublishVideo);
    if (!eligibleStatus) {
      return {
        ok: false,
        reason: `Ineligible status ${channel.connectionStatus}`,
      };
    }
    if (!caps.canPublishVideo) {
      return { ok: false, reason: 'canPublishVideo=false' };
    }
    return { ok: true };
  }

  private parseCapabilities(channel: {
    platform: SocialPlatform;
    publishingCapabilities: Prisma.JsonValue;
  }): PublishingCapabilities {
    const defaults = DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey];
    const stored = channel.publishingCapabilities;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const caps = stored as Partial<PublishingCapabilities>;
      if (typeof caps.canPublishVideo === 'boolean') {
        return { ...defaults, ...caps };
      }
    }
    return defaults;
  }

  private async maybeActivateReadyReplacement(userId: string, laneId: string) {
    const lane = await this.prisma.seriesLane.findUnique({ where: { id: laneId } });
    if (!lane?.activeSeriesId) return;
    if (lane.lastPublishedEpisodeNumber < lane.plannedEpisodeCount) return;

    const approved = await this.prisma.seriesReplacementPlan.findFirst({
      where: {
        userId,
        laneId,
        sourceSeriesId: lane.activeSeriesId,
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
      },
      orderBy: { approvedAt: 'desc' },
    });
    if (approved) {
      await this.replacements.activate(userId, approved.id);
    }
  }
}
