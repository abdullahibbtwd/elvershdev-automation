import { Injectable, Logger } from '@nestjs/common';
import {
  PublishStatus,
  Prisma,
  ScheduledPublicationStatus,
  SocialConnectionStatus,
  SocialPlatform,
  VideoRenderStatus,
} from '@prisma/client';
import {
  AUTOMATION_NOTIFICATION_TYPES,
  DEFAULT_CAPABILITIES,
  QUEUE_NAMES,
  addMinutes,
  buildViralHashtags,
  formatDateInTimeZone,
  zonedDateTimeToUtc,
  type AutomationPublishSchedulerPayload,
  type PublishingCapabilities,
  type SocialPlatformKey,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PublishingService } from '../publishing/publishing.service';

@Injectable()
export class AutomationPublishSchedulerService {
  private readonly logger = new Logger(AutomationPublishSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishingService: PublishingService,
    private readonly queueService: QueueService,
    private readonly notifications: NotificationsService,
  ) {}

  async scheduleForRender(input: {
    userId: string;
    contentScheduleId: string;
    videoRenderId: string;
    storyId: string | null;
    scheduledPublishAt: Date | null;
    config: {
      timezone: string;
      platformPublishingTimes: Prisma.JsonValue;
      channelPublishingEnabled: Prisma.JsonValue;
      activeChannelIds: string[];
      publishingWindowStart: string;
      maxConcurrentPublishing: number;
      maxDailyPublishingAttempts: number;
    };
  }) {
    const render = await this.prisma.videoRender.findFirst({
      where: {
        id: input.videoRenderId,
        userId: input.userId,
        status: VideoRenderStatus.COMPLETED,
        outputMediaAssetId: { not: null },
      },
      include: { outputMediaAsset: true, story: true },
    });
    if (!render || !render.outputMediaAsset) {
      throw new Error('Render is not ready for publishing');
    }

    const enabledMap = (input.config.channelPublishingEnabled ?? {}) as Record<string, boolean>;
    const platformTimes = (input.config.platformPublishingTimes ?? {}) as Record<string, string>;

    const channels = await this.prisma.socialChannel.findMany({
      where: {
        userId: input.userId,
        isActive: true,
        ...(input.config.activeChannelIds.length
          ? { id: { in: input.config.activeChannelIds } }
          : {}),
      },
    });

    let created = 0;
    let skipped = 0;
    const basePublishAt = input.scheduledPublishAt ?? new Date(Date.now() + 60_000);

    for (const channel of channels) {
      if (enabledMap[channel.platform] === false) {
        skipped += 1;
        continue;
      }

      const eligibility = this.evaluateEligibility(channel);
      const idempotencyKey = `auto-pub:${input.contentScheduleId}:${channel.id}`;
      const existing = await this.prisma.scheduledPublication.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const platformTime = platformTimes[channel.platform];
      let scheduledAt = basePublishAt;
      if (platformTime) {
        const day = formatDateInTimeZone(basePublishAt, input.config.timezone);
        scheduledAt = zonedDateTimeToUtc(day, platformTime, input.config.timezone);
        if (scheduledAt.getTime() < Date.now()) {
          scheduledAt = addMinutes(scheduledAt, 24 * 60);
        }
      }

      const status = eligibility.ok
        ? ScheduledPublicationStatus.SCHEDULED
        : ScheduledPublicationStatus.INELIGIBLE;

      try {
        await this.prisma.scheduledPublication.create({
          data: {
            userId: input.userId,
            contentScheduleId: input.contentScheduleId,
            channelId: channel.id,
            platform: channel.platform,
            status,
            scheduledAt,
            lastError: eligibility.ok ? null : eligibility.reason,
            idempotencyKey,
            metadata: {
              connectionStatus: channel.connectionStatus,
              eligibility,
            } as Prisma.InputJsonValue,
          },
        });
        created += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    // Kick scheduler to enqueue anything already due
    await this.enqueueTick({ mode: 'tick', userId: input.userId });

    return { created, skipped };
  }

  async processDuePublications(payload: AutomationPublishSchedulerPayload = { mode: 'tick' }) {
    const now = new Date();
    const due = await this.prisma.scheduledPublication.findMany({
      where: {
        status: ScheduledPublicationStatus.SCHEDULED,
        scheduledAt: { lte: now },
        ...(payload.userId ? { userId: payload.userId } : {}),
        ...(payload.scheduledPublicationId ? { id: payload.scheduledPublicationId } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });

    let enqueued = 0;
    let failed = 0;
    for (const item of due) {
      try {
        const result = await this.enqueueOne(item.id, payload.force === true);
        if (result.enqueued) enqueued += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Failed to enqueue scheduled publication ${item.id}: ${(error as Error).message}`,
        );
      }
    }

    return { scanned: due.length, enqueued, failed };
  }

  async enqueueOne(scheduledPublicationId: string, force = false) {
    // Atomic claim to prevent double scheduling across workers
    const claimed = await this.prisma.scheduledPublication.updateMany({
      where: {
        id: scheduledPublicationId,
        status: force
          ? { in: [ScheduledPublicationStatus.SCHEDULED, ScheduledPublicationStatus.FAILED] }
          : ScheduledPublicationStatus.SCHEDULED,
      },
      data: {
        status: ScheduledPublicationStatus.QUEUED,
      },
    });
    if (claimed.count === 0) {
      return { enqueued: false, reason: 'Not claimable' };
    }

    const item = await this.prisma.scheduledPublication.findUniqueOrThrow({
      where: { id: scheduledPublicationId },
      include: {
        contentSchedule: true,
      },
    });

    const config = await this.prisma.automationConfig.findUnique({
      where: { userId: item.userId },
    });
    if (!config) {
      await this.markFailed(item.id, 'Missing automation config');
      return { enqueued: false };
    }

    if (config.runMode === 'EMERGENCY_STOP' && !force) {
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: { status: ScheduledPublicationStatus.SCHEDULED, lastError: 'Emergency stop' },
      });
      return { enqueued: false, reason: 'Emergency stop' };
    }

    if (config.runMode === 'PAUSED' && !force) {
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: { status: ScheduledPublicationStatus.SCHEDULED, lastError: 'Paused' },
      });
      return { enqueued: false, reason: 'Paused' };
    }

    const activePublishing = await this.prisma.publishRecord.count({
      where: {
        userId: item.userId,
        status: {
          in: [
            PublishStatus.QUEUED,
            PublishStatus.VALIDATING,
            PublishStatus.UPLOADING,
            PublishStatus.PROCESSING,
            PublishStatus.PUBLISHING,
          ],
        },
      },
    });
    if (activePublishing >= config.maxConcurrentPublishing && !force) {
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: { status: ScheduledPublicationStatus.SCHEDULED },
      });
      return { enqueued: false, reason: 'Concurrency limit' };
    }

    const day = formatDateInTimeZone(new Date(), config.timezone);
    const dayStart = zonedDateTimeToUtc(day, '00:00', config.timezone);
    const dayEnd = addMinutes(dayStart, 24 * 60);
    const attemptsToday = await this.prisma.scheduledPublication.count({
      where: {
        userId: item.userId,
        updatedAt: { gte: dayStart, lt: dayEnd },
        status: {
          in: [
            ScheduledPublicationStatus.QUEUED,
            ScheduledPublicationStatus.PUBLISHING,
            ScheduledPublicationStatus.PUBLISHED,
            ScheduledPublicationStatus.FAILED,
          ],
        },
      },
    });
    if (attemptsToday >= config.maxDailyPublishingAttempts && !force) {
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: {
          status: ScheduledPublicationStatus.SCHEDULED,
          lastError: 'Max daily publishing attempts reached',
        },
      });
      return { enqueued: false, reason: 'Daily attempt limit' };
    }

    const renderId = item.contentSchedule.videoRenderId;
    if (!renderId) {
      await this.markFailed(item.id, 'Schedule missing videoRenderId');
      return { enqueued: false };
    }

    // Reconcile: if we already have a publish record with provider IDs, do not create another
    if (item.publishRecordId) {
      const existing = await this.prisma.publishRecord.findUnique({
        where: { id: item.publishRecordId },
      });
      if (existing) {
        if (existing.status === PublishStatus.PUBLISHED) {
          await this.prisma.scheduledPublication.update({
            where: { id: item.id },
            data: {
              status: ScheduledPublicationStatus.PUBLISHED,
              publishedAt: existing.publishedAt ?? new Date(),
            },
          });
          return { enqueued: false, reason: 'Already published' };
        }
        if (
          existing.providerUploadId ||
          existing.providerPublishId ||
          existing.providerPostId
        ) {
          await this.publishingService.retry(item.userId, existing.id);
          await this.prisma.scheduledPublication.update({
            where: { id: item.id },
            data: { status: ScheduledPublicationStatus.PUBLISHING },
          });
          return { enqueued: true, reconciled: true };
        }
      }
    }

    const channel = await this.prisma.socialChannel.findFirst({
      where: { id: item.channelId, userId: item.userId },
    });
    if (!channel) {
      await this.markFailed(item.id, 'Channel missing');
      await this.notifications.notify({
        userId: item.userId,
        type: AUTOMATION_NOTIFICATION_TYPES.CREDENTIALS_ISSUE,
        title: 'Publishing channel missing',
        body: `Scheduled publication ${item.id} could not find channel ${item.channelId}.`,
        dedupeKey: `channel-missing:${item.id}`,
      });
      return { enqueued: false };
    }

    const eligibility = this.evaluateEligibility(channel);
    if (!eligibility.ok) {
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: {
          status: ScheduledPublicationStatus.INELIGIBLE,
          lastError: eligibility.reason,
        },
      });
      if (
        channel.connectionStatus === SocialConnectionStatus.EXPIRED ||
        channel.connectionStatus === SocialConnectionStatus.REVOKED
      ) {
        await this.notifications.notify({
          userId: item.userId,
          type: AUTOMATION_NOTIFICATION_TYPES.CREDENTIALS_ISSUE,
          title: 'Social credentials expired or revoked',
          body: `${channel.platform} channel ${channel.accountName} cannot publish.`,
          dedupeKey: `creds:${channel.id}:${channel.connectionStatus}`,
        });
      }
      return { enqueued: false, reason: eligibility.reason };
    }

    const story = item.contentSchedule.storyId
      ? await this.prisma.story.findUnique({ where: { id: item.contentSchedule.storyId } })
      : null;
    const plan = item.contentSchedule.contentPlanId
      ? await this.prisma.contentPlan.findUnique({
          where: { id: item.contentSchedule.contentPlanId },
          select: { category: true, theme: true, metadata: true },
        })
      : null;
    const planMeta =
      plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
        ? (plan.metadata as Record<string, unknown>)
        : {};
    const slotKind =
      planMeta.slotKind === 'morning' || planMeta.slotKind === 'evening'
        ? planMeta.slotKind
        : null;

    const hashtags = buildViralHashtags({
      platform: channel.platform,
      seedTags: story?.hashtags ?? [],
      category: plan?.category,
      theme: plan?.theme,
      title: story?.title,
      slotKind,
    });
    // Caption body without tags — worker buildCaption appends hashtags once.
    const caption =
      story?.description?.trim() ||
      story?.openingHook?.trim() ||
      story?.title?.trim() ||
      'A short story worth watching.';

    try {
      const publications = await this.publishingService.publishRender(item.userId, renderId, {
        targets: [
          {
            channelId: channel.id,
            title: story?.title,
            caption,
            description: caption,
            hashtags,
          },
        ],
        idempotencyKey: item.idempotencyKey,
      });

      const publication = publications[0];
      await this.prisma.scheduledPublication.update({
        where: { id: item.id },
        data: {
          status: ScheduledPublicationStatus.PUBLISHING,
          publishRecordId: publication.id,
        },
      });

      // Keep PublishRecord.scheduledAt for audit
      await this.prisma.publishRecord.update({
        where: { id: publication.id },
        data: { scheduledAt: item.scheduledAt },
      });

      return { enqueued: true, publishRecordId: publication.id };
    } catch (error) {
      await this.markFailed(item.id, (error as Error).message);
      throw error;
    }
  }

  async reconcilePublicationOutcomes(userId?: string) {
    const active = await this.prisma.scheduledPublication.findMany({
      where: {
        ...(userId ? { userId } : {}),
        status: {
          in: [ScheduledPublicationStatus.QUEUED, ScheduledPublicationStatus.PUBLISHING],
        },
        publishRecordId: { not: null },
      },
      take: 100,
    });

    for (const item of active) {
      if (!item.publishRecordId) continue;
      const record = await this.prisma.publishRecord.findUnique({
        where: { id: item.publishRecordId },
      });
      if (!record) continue;

      if (record.status === PublishStatus.PUBLISHED) {
        await this.prisma.scheduledPublication.update({
          where: { id: item.id },
          data: {
            status: ScheduledPublicationStatus.PUBLISHED,
            publishedAt: record.publishedAt ?? new Date(),
            lastError: null,
          },
        });
        await this.notifications.notify({
          userId: item.userId,
          type: AUTOMATION_NOTIFICATION_TYPES.PUBLISH_SUCCESS,
          title: `${item.platform} publication succeeded`,
          body: record.postUrl ?? `Publication ${record.id} published.`,
          dedupeKey: `pub-success:${record.id}`,
        });
      } else if (record.status === PublishStatus.FAILED) {
        await this.prisma.scheduledPublication.update({
          where: { id: item.id },
          data: {
            status: ScheduledPublicationStatus.FAILED,
            lastError: record.errorMessage,
            retryCount: { increment: 1 },
          },
        });
      } else if (record.status === PublishStatus.CANCELLED) {
        await this.prisma.scheduledPublication.update({
          where: { id: item.id },
          data: { status: ScheduledPublicationStatus.CANCELLED },
        });
      }
    }

    // Partial / complete failure notifications per content schedule
    if (userId) {
      await this.notifySchedulePublishSummary(userId);
    }

    return { reconciled: active.length };
  }

  async enqueueTick(payload: AutomationPublishSchedulerPayload) {
    const queue = this.queueService.getQueue(QUEUE_NAMES.AUTOMATION_PUBLISH_SCHEDULER);
    await queue.add('tick', payload, {
      jobId: `auto-pub-tick-${payload.userId ?? 'all'}-${payload.mode}-${Date.now()}`,
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 2,
    });
  }

  private async notifySchedulePublishSummary(userId: string) {
    const schedules = await this.prisma.contentSchedule.findMany({
      where: {
        userId,
        status: { in: ['PUBLISHING', 'SCHEDULING_PUBLISH', 'COMPLETED'] },
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      include: { scheduledPublications: true },
      take: 20,
    });

    for (const schedule of schedules) {
      const pubs = schedule.scheduledPublications;
      if (!pubs.length) continue;
      const terminal = pubs.every((p) =>
        ['PUBLISHED', 'FAILED', 'CANCELLED', 'SKIPPED', 'INELIGIBLE'].includes(p.status),
      );
      if (!terminal) continue;
      const published = pubs.filter((p) => p.status === 'PUBLISHED').length;
      const failed = pubs.filter((p) => p.status === 'FAILED' || p.status === 'INELIGIBLE').length;
      if (failed > 0 && published > 0) {
        await this.notifications.notify({
          userId,
          type: AUTOMATION_NOTIFICATION_TYPES.PUBLISH_PARTIAL_FAILURE,
          title: 'Partial publishing failure',
          body: `Schedule ${schedule.id}: ${published} published, ${failed} failed/ineligible.`,
          dedupeKey: `pub-partial:${schedule.id}`,
        });
      } else if (failed > 0 && published === 0) {
        await this.notifications.notify({
          userId,
          type: AUTOMATION_NOTIFICATION_TYPES.PUBLISH_COMPLETE_FAILURE,
          title: 'Publishing failed on all channels',
          body: `Schedule ${schedule.id} failed to publish on eligible channels.`,
          dedupeKey: `pub-all-fail:${schedule.id}`,
        });
      }
    }
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

  private async markFailed(id: string, reason: string) {
    await this.prisma.scheduledPublication.update({
      where: { id },
      data: {
        status: ScheduledPublicationStatus.FAILED,
        lastError: reason,
        retryCount: { increment: 1 },
      },
    });
  }
}
