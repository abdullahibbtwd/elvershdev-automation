import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { AnalyticsCostService } from './analytics-cost.service';
import { AnalyticsDatePreset, AnalyticsListDto, AnalyticsRangeDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: AnalyticsCostService,
  ) {}

  range(query: AnalyticsRangeDto) {
    const now = new Date();
    const end = new Date(now);
    let start: Date;
    switch (query.preset) {
      case AnalyticsDatePreset.CUSTOM:
        start = new Date(query.from!);
        return { from: start, to: new Date(query.to!) };
      case AnalyticsDatePreset.LAST_7_DAYS:
        start = new Date(now.getTime() - 7 * 86_400_000);
        break;
      case AnalyticsDatePreset.LAST_90_DAYS:
        start = new Date(now.getTime() - 90 * 86_400_000);
        break;
      case AnalyticsDatePreset.THIS_MONTH:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        break;
      case AnalyticsDatePreset.PREVIOUS_MONTH:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        return { from: start, to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)) };
      default:
        start = new Date(now.getTime() - 30 * 86_400_000);
    }
    return { from: start, to: end };
  }

  async overview(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    const [videos, rendersGenerated, pubs] = await Promise.all([
      this.prisma.videoAnalytics.findMany({
        where: {
          userId,
          OR: [
            { publishedAt: { gte: range.from, lte: range.to } },
            { publishedAt: null, createdAt: { gte: range.from, lte: range.to } },
          ],
        },
        include: { platformPosts: true },
      }),
      this.prisma.videoRender.count({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { gte: range.from, lte: range.to },
        },
      }),
      this.prisma.publishRecord.groupBy({
        by: ['status'],
        where: {
          userId,
          OR: [
            { publishedAt: { gte: range.from, lte: range.to } },
            { publishedAt: null, createdAt: { gte: range.from, lte: range.to } },
          ],
        },
        _count: { _all: true },
      }),
    ]);

    const publishedCount = pubs
      .filter((row) => row.status === 'PUBLISHED')
      .reduce((sum, row) => sum + row._count._all, 0);
    const failedCount = pubs
      .filter((row) => row.status === 'FAILED')
      .reduce((sum, row) => sum + row._count._all, 0);

    const availableViews = videos.filter((video) => video.aggregateViews != null);
    const totalViews = availableViews.length
      ? availableViews.reduce((sum, video) => sum + video.aggregateViews!, 0n)
      : null;
    const availableEngagement = videos.filter((video) => video.aggregateEngagement != null);
    const totalEngagement = availableEngagement.length
      ? availableEngagement.reduce((sum, video) => sum + video.aggregateEngagement!, 0n)
      : null;
    const totalCostUsd = videos.reduce(
      (sum, video) => sum + Number(video.totalProductionCostUsd),
      0,
    );
    const avgCostPerVideo =
      videos.length > 0 ? totalCostUsd / videos.length : null;

    const bestVideo =
      availableViews.length > 0
        ? [...availableViews].sort((a, b) =>
            Number((b.aggregateViews ?? 0n) - (a.aggregateViews ?? 0n)),
          )[0]
        : null;

    const platformViewTotals = new Map<string, { views: bigint; posts: number }>();
    for (const video of videos) {
      for (const post of video.platformPosts) {
        if (post.views == null) continue;
        const cur = platformViewTotals.get(post.platform) ?? { views: 0n, posts: 0 };
        cur.views += post.views;
        cur.posts += 1;
        platformViewTotals.set(post.platform, cur);
      }
    }
    const bestPlatformEntry = [...platformViewTotals.entries()].sort((a, b) =>
      Number(b[1].views - a[1].views),
    )[0];

    const lastSyncedAt = videos.reduce<Date | null>((latest, video) => {
      if (!video.lastSyncedAt) return latest;
      if (!latest || video.lastSyncedAt > latest) return video.lastSyncedAt;
      return latest;
    }, null);

    return {
      range,
      videosGenerated: rendersGenerated,
      videosPublished: publishedCount,
      successfulPublications: publishedCount,
      failedPublications: failedCount,
      videos: videos.length,
      totalViews,
      totalEngagement,
      totalCostUsd,
      estimatedTotalProductionSpendUsd: totalCostUsd,
      averageCostPerVideoUsd: avgCostPerVideo,
      costsAreEstimates: true,
      costNote:
        'Production spend is estimated from ProviderUsage.estimatedCost; not provider billing invoices.',
      aggregationMethod: 'sum_available_platforms_only',
      aggregationNote:
        'Totals only include platforms/videos where the metric status is AVAILABLE. Unavailable metrics are excluded (never treated as zero). Platform view definitions differ and should not be compared as identical.',
      bestPerformingVideo: bestVideo
        ? {
            videoRenderId: bestVideo.videoRenderId,
            title: bestVideo.title,
            category: bestVideo.category,
            aggregateViews: bestVideo.aggregateViews,
            aggregateEngagement: bestVideo.aggregateEngagement,
            totalProductionCostUsd: bestVideo.totalProductionCostUsd,
          }
        : null,
      bestPerformingPlatform: bestPlatformEntry
        ? {
            platform: bestPlatformEntry[0],
            totalViews: bestPlatformEntry[1].views,
            postsWithViews: bestPlatformEntry[1].posts,
            note: 'Ranked by sum of AVAILABLE views only; definitions differ by platform.',
          }
        : null,
      lastSyncedAt,
      coverage: {
        videosWithViews: availableViews.length,
        videosWithEngagement: availableEngagement.length,
      },
      metricDefinitions: {
        views: 'Platform-native view/play definitions; see platformNotes on each post.',
        engagement: 'Sum of available likes+comments+shares when present; saves included only when available.',
      },
    };
  }

  async trends(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    const posts = await this.prisma.platformPostAnalytics.findMany({
      where: { userId, publishedAt: { gte: range.from, lte: range.to } },
      orderBy: { publishedAt: 'asc' },
    });
    const days = new Map<string, { views: bigint | null; engagement: bigint | null; posts: number }>();
    for (const post of posts) {
      const day = (post.publishedAt ?? post.createdAt).toISOString().slice(0, 10);
      const current = days.get(day) ?? { views: null, engagement: null, posts: 0 };
      if (post.views != null) current.views = (current.views ?? 0n) + post.views;
      const parts = [post.likes, post.comments, post.shares].filter((v): v is bigint => v != null);
      if (parts.length) current.engagement = (current.engagement ?? 0n) + parts.reduce((a, b) => a + b, 0n);
      current.posts += 1;
      days.set(day, current);
    }
    return [...days.entries()].map(([date, metrics]) => ({ date, ...metrics }));
  }

  async platforms(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    const posts = await this.prisma.platformPostAnalytics.findMany({
      where: { userId, publishedAt: { gte: range.from, lte: range.to } },
    });
    return Object.values(SocialPlatform).map((platform) => {
      const rows = posts.filter((post) => post.platform === platform);
      const views = rows.filter((post) => post.views != null);
      return {
        platform,
        posts: rows.length,
        totalViews: views.length ? views.reduce((sum, post) => sum + post.views!, 0n) : null,
        metricCoverage: { views: views.length },
      };
    });
  }

  async content(userId: string, query: AnalyticsListDto) {
    const range = this.range(query);
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.VideoAnalyticsWhereInput = {
      userId,
      publishedAt: { gte: range.from, lte: range.to },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.videoAnalytics.findMany({
        where, orderBy: { publishedAt: 'desc' }, skip, take: limit,
        include: { platformPosts: true },
      }),
      this.prisma.videoAnalytics.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async video(userId: string, videoRenderId: string) {
    const video = await this.prisma.videoAnalytics.findFirst({
      where: { userId, videoRenderId },
      include: { platformPosts: true },
    });
    if (!video) throw new NotFoundException('Video analytics not found');
    return video;
  }

  async videoPlatforms(userId: string, videoRenderId: string) {
    await this.requireRender(userId, videoRenderId);
    return this.prisma.platformPostAnalytics.findMany({
      where: { userId, videoRenderId },
      orderBy: { publishedAt: 'desc' },
    });
  }

  costsSummary(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    return this.costs.summarize(userId, range.from, range.to);
  }

  costsProviders(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    return this.costs.providers(userId, range.from, range.to);
  }

  costsVideos(userId: string, query: AnalyticsRangeDto) {
    const range = this.range(query);
    return this.costs.videos(userId, range.from, range.to);
  }

  private async requireRender(userId: string, videoRenderId: string) {
    const render = await this.prisma.videoRender.findFirst({ where: { id: videoRenderId, userId } });
    if (!render) throw new NotFoundException('Video render not found');
    return render;
  }
}
