import { Injectable } from '@nestjs/common';
import { Prisma, type SocialPlatform } from '@prisma/client';
import {
  calculateEngagementRate,
  metricValueOrNull,
  optionalToDbBigInt,
  optionalToDbFloat,
  toAvailabilityMap,
  type NormalizedPostMetrics,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsAggregationService {
  constructor(private readonly prisma: PrismaService) {}

  async persistPostMetrics(
    userId: string,
    publishRecord: {
      id: string;
      videoRenderId: string | null;
      channelId: string | null;
      platform: SocialPlatform;
      publishedAt: Date | null;
      postUrl: string | null;
    },
    metrics: NormalizedPostMetrics,
  ) {
    const engagement = calculateEngagementRate({
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      includeSaves: metricValueOrNull(metrics.saves) != null,
    });
    const data = {
      userId,
      videoRenderId: publishRecord.videoRenderId,
      channelId: publishRecord.channelId,
      platform: publishRecord.platform,
      providerPostId: metrics.providerPostId,
      postUrl: metrics.postUrl ?? publishRecord.postUrl,
      publishedAt: metrics.publishedAt ? new Date(metrics.publishedAt) : publishRecord.publishedAt,
      views: optionalToDbBigInt(metrics.views),
      reach: optionalToDbBigInt(metrics.reach),
      impressions: optionalToDbBigInt(metrics.impressions),
      likes: optionalToDbBigInt(metrics.likes),
      comments: optionalToDbBigInt(metrics.comments),
      shares: optionalToDbBigInt(metrics.shares),
      saves: optionalToDbBigInt(metrics.saves),
      watchTimeSeconds: optionalToDbFloat(metrics.watchTimeSeconds),
      averageWatchSeconds: optionalToDbFloat(metrics.averageWatchSeconds),
      completionRate: optionalToDbFloat(metrics.completionRate),
      engagementRate: engagement.available ? engagement.value : null,
      followersGained: optionalToDbFloat(metrics.followersGained),
      metricAvailability: toAvailabilityMap({
        views: metrics.views,
        reach: metrics.reach,
        impressions: metrics.impressions,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        watchTimeSeconds: metrics.watchTimeSeconds,
        averageWatchSeconds: metrics.averageWatchSeconds,
        completionRate: metrics.completionRate,
        followersGained: metrics.followersGained,
      }) as Prisma.InputJsonValue,
      metricSource: metrics.metricSource,
      lastSuccessfulSyncAt: new Date(),
      lastSyncAttemptAt: new Date(),
      lastSyncError: null,
      syncFailCount: 0,
      rawProviderResponse: this.capRaw(metrics.raw),
      platformMetricNotes: metrics.platformNotes as Prisma.InputJsonValue,
    };
    return this.prisma.platformPostAnalytics.upsert({
      where: { publishRecordId: publishRecord.id },
      create: { publishRecordId: publishRecord.id, ...data },
      update: data,
    });
  }

  async aggregateVideo(userId: string, videoRenderId: string) {
    const render = await this.prisma.videoRender.findFirst({
      where: { id: videoRenderId, userId },
      include: { story: true, publishRecords: true },
    });
    if (!render) return null;
    const posts = await this.prisma.platformPostAnalytics.findMany({
      where: { userId, videoRenderId },
    });
    const usage = await this.prisma.providerUsage.findMany({
      where: { userId, storyId: render.storyId },
      select: { id: true, estimatedCost: true, provider: true, requestType: true },
    });
    const uniqueUsage = [...new Map(usage.map((item) => [item.id, item])).values()];
    const cost = uniqueUsage.reduce((sum, item) => sum + Number(item.estimatedCost), 0);
    const sum = (key: 'views' | 'likes' | 'comments' | 'shares') => {
      const values = posts.map((post) => post[key]).filter((value): value is bigint => value != null);
      return values.length ? values.reduce((a, b) => a + b, 0n) : null;
    };
    const views = sum('views');
    const likes = sum('likes');
    const comments = sum('comments');
    const shares = sum('shares');
    const engagementParts = [likes, comments, shares];
    const aggregateEngagement = engagementParts.every((value) => value == null)
      ? null
      : engagementParts.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);
    const video = await this.prisma.videoAnalytics.upsert({
      where: { videoRenderId },
      create: {
        userId,
        storyId: render.storyId,
        videoRenderId,
        title: render.story.title,
        category: render.story.category,
        publishedAt: this.earliest(render.publishRecords.map((p) => p.publishedAt)),
        renderDurationMs: render.processingTimeMs,
        videoDurationSeconds: render.duration,
        generationCostUsd: new Prisma.Decimal(cost),
        totalProductionCostUsd: new Prisma.Decimal(cost),
        platformsPublishedCount: posts.length,
        aggregateViews: views,
        aggregateLikes: likes,
        aggregateComments: comments,
        aggregateShares: shares,
        aggregateEngagement,
        platformsWithViewsCount: posts.filter((p) => p.views != null).length,
        platformsWithEngagementCount: posts.filter(
          (p) => p.likes != null || p.comments != null || p.shares != null,
        ).length,
        lastSyncedAt: new Date(),
        costBreakdown: this.costBreakdown(uniqueUsage),
      },
      update: {
        generationCostUsd: new Prisma.Decimal(cost),
        totalProductionCostUsd: new Prisma.Decimal(cost),
        platformsPublishedCount: posts.length,
        aggregateViews: views,
        aggregateLikes: likes,
        aggregateComments: comments,
        aggregateShares: shares,
        aggregateEngagement,
        platformsWithViewsCount: posts.filter((p) => p.views != null).length,
        platformsWithEngagementCount: posts.filter(
          (p) => p.likes != null || p.comments != null || p.shares != null,
        ).length,
        lastSyncedAt: new Date(),
        costBreakdown: this.costBreakdown(uniqueUsage),
      },
    });
    await this.prisma.platformPostAnalytics.updateMany({
      where: { userId, videoRenderId },
      data: { videoAnalyticsId: video.id },
    });
    return video;
  }

  async createSnapshot(
    userId: string,
    windowType: string,
    start: Date,
    end: Date,
    metrics: Prisma.InputJsonValue,
    scope = 'overview',
  ) {
    const snapshotKey = `${userId}:${windowType}:${start.toISOString()}:${end.toISOString()}:${scope}`;
    return this.prisma.analyticsSnapshot.upsert({
      where: { snapshotKey },
      create: { userId, windowType, windowStart: start, windowEnd: end, snapshotKey, scope, metrics },
      update: { metrics },
    });
  }

  async rollupContent(userId: string, from: Date, to: Date) {
    const videos = await this.prisma.videoAnalytics.findMany({
      where: { userId, publishedAt: { gte: from, lte: to }, category: { not: null } },
    });
    const groups = new Map<string, typeof videos>();
    for (const video of videos) {
      const category = video.category!;
      groups.set(category, [...(groups.get(category) ?? []), video]);
    }
    for (const [category, rows] of groups) {
      const availableViews = rows.filter((r) => r.aggregateViews != null);
      const totalViews = availableViews.length
        ? availableViews.reduce((sum, row) => sum + row.aggregateViews!, 0n)
        : null;
      const summaryKey = `${userId}:category:${category}:${from.toISOString()}:${to.toISOString()}:all`;
      await this.prisma.contentPerformanceSummary.upsert({
        where: { summaryKey },
        create: {
          userId, dimension: 'category', dimensionValue: category, sampleSize: rows.length,
          dateFrom: from, dateTo: to, totalViews,
          avgViews: totalViews == null ? null : Number(totalViews) / availableViews.length,
          avgCostUsd: rows.reduce((sum, r) => sum + Number(r.totalProductionCostUsd), 0) / rows.length,
          summaryKey,
        },
        update: {
          sampleSize: rows.length, totalViews,
          avgViews: totalViews == null ? null : Number(totalViews) / availableViews.length,
          avgCostUsd: rows.reduce((sum, r) => sum + Number(r.totalProductionCostUsd), 0) / rows.length,
        },
      });
    }
    return { summaries: groups.size };
  }

  private capRaw(raw?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    if (!raw) return undefined;
    const json = JSON.stringify(raw);
    return (json.length <= 8192 ? raw : { truncated: true, preview: json.slice(0, 8000) }) as Prisma.InputJsonValue;
  }

  private earliest(values: Array<Date | null>): Date | null {
    const dates = values.filter((value): value is Date => value != null);
    return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
  }

  private costBreakdown(
    usage: Array<{ provider: string; requestType: string; estimatedCost: Prisma.Decimal }>,
  ): Prisma.InputJsonValue {
    const providers: Record<string, number> = {};
    const stages: Record<string, number> = {};
    for (const item of usage) {
      providers[item.provider] = (providers[item.provider] ?? 0) + Number(item.estimatedCost);
      stages[item.requestType] = (stages[item.requestType] ?? 0) + Number(item.estimatedCost);
    }
    return { providers, stages };
  }
}
