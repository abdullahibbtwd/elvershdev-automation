import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnalyticsSyncJobStatus,
  AnalyticsSyncJobType,
  Prisma,
  PublishStatus,
} from '@prisma/client';
import {
  ANALYTICS_NOTIFICATION_TYPES,
  QUEUE_NAMES,
  type AnalyticsPostRefreshPayload,
  type AnalyticsSyncQueuePayload,
  type SocialPlatformKey,
} from '@ai-video/shared';
import { mockPostAnalytics } from '../../integrations/analytics/mock-analytics';
import { SocialProviderRegistry } from '../../integrations/social/social-provider.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { ChannelsService } from '../channels/channels.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';

@Injectable()
export class AnalyticsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly channels: ChannelsService,
    private readonly providers: SocialProviderRegistry,
    private readonly aggregation: AnalyticsAggregationService,
    private readonly notifications: NotificationsService,
  ) {}

  async start(userId: string, options?: { force?: boolean; useMockAnalytics?: boolean }) {
    return this.enqueueSync(userId, AnalyticsSyncJobType.MANUAL, 'manual', options);
  }

  async startPeriodic(userId: string) {
    const hour = new Date().toISOString().slice(0, 13);
    const existing = await this.prisma.analyticsSyncJob.findUnique({
      where: { idempotencyKey: `periodic:${userId}:${hour}` },
    });
    if (existing) return existing;
    return this.enqueueSync(
      userId,
      AnalyticsSyncJobType.FULL,
      'full',
      { useMockAnalytics: process.env.SOCIAL_USE_MOCK === 'true' },
      `periodic:${userId}:${hour}`,
    );
  }

  async startInitialPost(userId: string, publishRecordId: string) {
    return this.enqueueSync(
      userId,
      AnalyticsSyncJobType.INITIAL_POST,
      'initial_post',
      { useMockAnalytics: process.env.SOCIAL_USE_MOCK === 'true', publishRecordId } as never,
      `initial:${publishRecordId}`,
    );
  }

  private async enqueueSync(
    userId: string,
    jobType: AnalyticsSyncJobType,
    mode: AnalyticsSyncQueuePayload['mode'],
    options?: { force?: boolean; useMockAnalytics?: boolean; publishRecordId?: string },
    idempotencyKey?: string,
  ) {
    const job = await this.prisma.analyticsSyncJob.create({
      data: {
        userId,
        jobType,
        status: AnalyticsSyncJobStatus.PENDING,
        publishRecordId: options?.publishRecordId,
        idempotencyKey:
          idempotencyKey ??
          (options?.force ? null : `manual:${userId}:${new Date().toISOString().slice(0, 13)}`),
        payload: (options ?? {}) as Prisma.InputJsonValue,
      },
    });
    const payload: AnalyticsSyncQueuePayload = {
      analyticsSyncJobId: job.id,
      userId,
      mode,
      publishRecordId: options?.publishRecordId,
      force: options?.force,
      useMockAnalytics: options?.useMockAnalytics,
    };
    const queued = await this.queues.getQueue(QUEUE_NAMES.ANALYTICS_SYNC).add('sync', payload, {
      jobId: job.id, attempts: job.maxAttempts,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    return this.prisma.analyticsSyncJob.update({
      where: { id: job.id },
      data: { status: AnalyticsSyncJobStatus.QUEUED, queueName: QUEUE_NAMES.ANALYTICS_SYNC, queueJobId: String(queued.id) },
    });
  }

  async list(userId: string) {
    return this.prisma.analyticsSyncJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.analyticsSyncJob.findFirst({ where: { id, userId } });
    if (!job) throw new NotFoundException('Analytics sync job not found');
    return job;
  }

  async processSync(payload: AnalyticsSyncQueuePayload) {
    await this.requireOwnedJob(payload.analyticsSyncJobId, payload.userId);
    await this.prisma.analyticsSyncJob.update({
      where: { id: payload.analyticsSyncJobId },
      data: { status: AnalyticsSyncJobStatus.RUNNING, startedAt: new Date(), attemptCount: { increment: 1 } },
    });
    const settings = await this.settings(payload.userId);
    const cutoff = new Date(Date.now() - settings.recentPostMaxAgeDays * 86_400_000);
    const posts = await this.prisma.publishRecord.findMany({
      where: {
        userId: payload.userId,
        status: PublishStatus.PUBLISHED,
        providerPostId: { not: null },
        ...(payload.publishRecordId ? { id: payload.publishRecordId } : {}),
      },
      include: { platformPostAnalytics: true },
      orderBy: { publishedAt: 'desc' },
      take: 500,
    });
    const due = posts.filter((post) => {
      if (payload.force || !post.platformPostAnalytics?.lastSuccessfulSyncAt) return true;
      const recent = (post.publishedAt ?? post.createdAt) >= cutoff;
      const hours = recent ? settings.syncRecentHours : settings.syncOlderHours;
      return post.platformPostAnalytics.lastSuccessfulSyncAt.getTime() <= Date.now() - hours * 3_600_000;
    });
    await this.prisma.analyticsSyncJob.update({
      where: { id: payload.analyticsSyncJobId },
      data: { postsTargeted: due.length, postsSkipped: posts.length - due.length },
    });
    const results = await Promise.allSettled(
      due.map((post) =>
        this.refreshPost({
          analyticsSyncJobId: payload.analyticsSyncJobId,
          userId: payload.userId,
          publishRecordId: post.id,
          useMockAnalytics: payload.useMockAnalytics,
          force: payload.force,
        }),
      ),
    );
    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    const status = failed === 0
      ? AnalyticsSyncJobStatus.COMPLETED
      : succeeded > 0
        ? AnalyticsSyncJobStatus.PARTIAL
        : AnalyticsSyncJobStatus.FAILED;
    const updated = await this.prisma.analyticsSyncJob.update({
      where: { id: payload.analyticsSyncJobId },
      data: {
        status, postsSucceeded: succeeded, postsFailed: failed, progress: 100,
        completedAt: new Date(),
        lastError: failed ? `${failed} post refresh(es) failed` : null,
        platformResults: results.map((result, index) => ({
          publishRecordId: due[index]?.id,
          status: result.status,
          error: result.status === 'rejected' ? String(result.reason) : undefined,
        })) as Prisma.InputJsonValue,
      },
    });
    if (failed) await this.notifyFailure(payload.userId, updated.id, failed, succeeded);
    return updated;
  }

  async refreshPost(payload: AnalyticsPostRefreshPayload) {
    await this.requireOwnedJob(payload.analyticsSyncJobId, payload.userId);
    const post = await this.prisma.publishRecord.findFirst({
      where: { id: payload.publishRecordId, userId: payload.userId },
    });
    if (!post?.providerPostId || !post.channelId) throw new Error('Published post or channel not found');
    try {
      const useMock =
        payload.useMockAnalytics === true ||
        process.env.SOCIAL_USE_MOCK === 'true' ||
        process.env.NODE_ENV === 'test';
      const metrics = useMock
        ? mockPostAnalytics(post.platform as SocialPlatformKey, post.providerPostId, post.postUrl)
        : await this.fetchLive(payload.userId, post.channelId, post.platform as SocialPlatformKey, post.providerPostId, post.postUrl);
      const stored = await this.aggregation.persistPostMetrics(payload.userId, post, metrics);
      if (post.videoRenderId) await this.aggregation.aggregateVideo(payload.userId, post.videoRenderId);
      return stored;
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.platformPostAnalytics.upsert({
        where: { publishRecordId: post.id },
        create: {
          userId: payload.userId, publishRecordId: post.id, videoRenderId: post.videoRenderId,
          channelId: post.channelId, platform: post.platform, providerPostId: post.providerPostId,
          postUrl: post.postUrl, publishedAt: post.publishedAt, metricSource: 'UNAVAILABLE',
          lastSyncAttemptAt: new Date(), lastSyncError: message, syncFailCount: 1,
        },
        update: {
          lastSyncAttemptAt: new Date(), lastSyncError: message,
          syncFailCount: { increment: 1 },
        },
      });
      if (/permission|scope|unauthori[sz]ed|expired|401|403/i.test(message)) {
        await this.notifications.notify({
          userId: payload.userId,
          type: ANALYTICS_NOTIFICATION_TYPES.PERMISSIONS_EXPIRED,
          title: 'Analytics permissions need attention',
          body: `Reconnect ${post.platform} to restore analytics access.`,
          dedupeKey: `analytics:permissions:${post.channelId}`,
          metadata: { channelId: post.channelId, platform: post.platform },
        });
      }
      throw error;
    }
  }

  async recover() {
    const jobs = await this.prisma.analyticsSyncJob.findMany({
      where: {
        status: { in: [AnalyticsSyncJobStatus.PENDING, AnalyticsSyncJobStatus.QUEUED, AnalyticsSyncJobStatus.RUNNING] },
        updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
      },
      take: 100,
    });
    for (const job of jobs) {
      if (job.attemptCount >= job.maxAttempts) {
        await this.prisma.analyticsSyncJob.update({
          where: { id: job.id },
          data: { status: AnalyticsSyncJobStatus.FAILED, completedAt: new Date(), lastError: 'Retry limit exceeded during recovery' },
        });
        continue;
      }
      await this.queues.getQueue(QUEUE_NAMES.ANALYTICS_SYNC).add(
        'recover',
        { analyticsSyncJobId: job.id, userId: job.userId, mode: 'full', force: true },
        { jobId: `${job.id}-recover-${job.attemptCount}`, attempts: job.maxAttempts - job.attemptCount, backoff: { type: 'exponential', delay: 10_000 } },
      );
    }
    return { recovered: jobs.length };
  }

  private async fetchLive(
    userId: string, channelId: string, platform: SocialPlatformKey,
    providerPostId: string, postUrl: string | null,
  ) {
    const tokens = await this.channels.getDecryptedTokens(channelId, userId);
    const provider = this.providers.get(platform);
    if (!provider.getPostAnalytics) throw new Error(`${platform} analytics is unavailable`);
    return provider.getPostAnalytics({
      accessToken: tokens.accessToken,
      platformAccountId: tokens.platformAccountId,
      providerPostId,
      postUrl,
    });
  }

  private settings(userId: string) {
    return this.prisma.analyticsOptimizationSettings.upsert({
      where: { userId }, create: { userId }, update: {},
    });
  }

  private async requireOwnedJob(id: string, userId: string) {
    const job = await this.prisma.analyticsSyncJob.findFirst({ where: { id, userId } });
    if (!job) throw new NotFoundException('Analytics sync job not found');
    return job;
  }

  private notifyFailure(userId: string, jobId: string, failed: number, succeeded: number) {
    return this.notifications.notify({
      userId,
      type: ANALYTICS_NOTIFICATION_TYPES.SYNC_FAILURE,
      title: succeeded ? 'Analytics sync partially completed' : 'Analytics sync failed',
      body: `${failed} platform post(s) failed; ${succeeded} succeeded.`,
      dedupeKey: `analytics:sync-failure:${jobId}`,
      metadata: { jobId, failed, succeeded },
    });
  }
}
