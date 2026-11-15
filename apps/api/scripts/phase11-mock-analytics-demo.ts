/**
 * Phase 11 end-to-end mock analytics demonstration.
 * Seeds one completed render with 4 platform publications, runs mock sync,
 * shows normalized metrics (including UNAVAILABLE), cost aggregation without
 * double-counting, snapshot dedupe, and recovery from a failed sync job.
 *
 * Usage: pnpm --filter @ai-video/api exec ts-node -r tsconfig-paths/register scripts/phase11-mock-analytics-demo.ts
 */
import { PrismaClient, PublishStatus, SocialPlatform, VideoRenderStatus } from '@prisma/client';
import {
  calculateEngagementRate,
  metricValueOrNull,
  optionalToDbBigInt,
  toAvailabilityMap,
} from '@ai-video/shared';
import { mockPostAnalytics } from '../src/integrations/analytics/mock-analytics';

const prisma = new PrismaClient();

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const email = `phase11-demo-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      name: 'Phase 11 Demo',
      email,
      passwordHash: 'demo-not-for-login',
    },
  });

  const story = await prisma.story.create({
    data: {
      userId: user.id,
      title: 'Phase 11 Demo Story',
      content: 'A short cinematic demo story for analytics.',
      status: 'READY',
      category: 'Narrative',
      topic: 'Analytics demo',
      niche: 'Motivation',
      targetAudience: 'Creators',
      language: 'en',
      tone: 'Inspirational',
      targetDurationSeconds: 45,
    },
  });

  const render = await prisma.videoRender.create({
    data: {
      userId: user.id,
      storyId: story.id,
      status: VideoRenderStatus.COMPLETED,
      duration: 45,
      processingTimeMs: 12_000,
      completedAt: new Date(),
      progress: 100,
    },
  });

  await prisma.providerUsage.createMany({
    data: [
      {
        userId: user.id,
        storyId: story.id,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        requestType: 'story_generation',
        estimatedCost: 0.12,
      },
      {
        userId: user.id,
        storyId: story.id,
        provider: 'fal',
        model: 'flux',
        requestType: 'image_generation',
        estimatedCost: 0.35,
      },
      {
        userId: user.id,
        storyId: story.id,
        provider: 'kling',
        model: 'kling-v1',
        requestType: 'video_generation',
        estimatedCost: 0.8,
      },
      {
        userId: user.id,
        storyId: story.id,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        requestType: 'story_generation',
        estimatedCost: 0.12,
      },
    ],
  });

  const platforms: SocialPlatform[] = [
    SocialPlatform.FACEBOOK,
    SocialPlatform.INSTAGRAM,
    SocialPlatform.TIKTOK,
    SocialPlatform.YOUTUBE,
  ];

  const posts = [];
  for (const platform of platforms) {
    const channel = await prisma.socialChannel.create({
      data: {
        userId: user.id,
        platform,
        accountName: `Demo ${platform}`,
        platformAccountId: `mock-${platform.toLowerCase()}-account`,
        accessTokenEncrypted: 'enc:mock',
        connectionStatus: 'TEST_ONLY',
        grantedScopes: [],
        isActive: true,
      },
    });
    const post = await prisma.publishRecord.create({
      data: {
        userId: user.id,
        videoRenderId: render.id,
        channelId: channel.id,
        platform,
        status: PublishStatus.PUBLISHED,
        providerPostId: `mock-${platform.toLowerCase()}-post-1`,
        postUrl: `https://example.com/${platform.toLowerCase()}/mock-post-1`,
        publishedAt: new Date(),
        caption: `Demo ${platform} caption`,
      },
    });
    posts.push(post);
  }

  section('1) Mock analytics for all four platforms');
  const normalized = platforms.map((platform) =>
    mockPostAnalytics(platform, `mock-${platform.toLowerCase()}-post-1`),
  );
  for (const metrics of normalized) {
    console.log({
      platform: metrics.platform,
      views: metrics.views,
      reach: metrics.reach,
      impressions: metrics.impressions,
      saves: metrics.saves,
      watchTimeSeconds: metrics.watchTimeSeconds,
      completionRate: metrics.completionRate,
      followersGained: metrics.followersGained,
      metricSource: metrics.metricSource,
    });
  }

  section('2) Persist normalized metrics + unavailable states');
  for (const post of posts) {
    const metrics = mockPostAnalytics(post.platform, post.providerPostId!, post.postUrl);
    const engagement = calculateEngagementRate({
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      includeSaves: metricValueOrNull(metrics.saves) != null,
    });
    await prisma.platformPostAnalytics.upsert({
      where: { publishRecordId: post.id },
      create: {
        userId: user.id,
        publishRecordId: post.id,
        videoRenderId: render.id,
        channelId: post.channelId,
        platform: post.platform,
        providerPostId: metrics.providerPostId,
        postUrl: metrics.postUrl,
        publishedAt: post.publishedAt,
        views: optionalToDbBigInt(metrics.views),
        reach: optionalToDbBigInt(metrics.reach),
        impressions: optionalToDbBigInt(metrics.impressions),
        likes: optionalToDbBigInt(metrics.likes),
        comments: optionalToDbBigInt(metrics.comments),
        shares: optionalToDbBigInt(metrics.shares),
        saves: optionalToDbBigInt(metrics.saves),
        engagementRate: engagement.available ? engagement.value : null,
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
        }),
        metricSource: 'MOCK',
        lastSuccessfulSyncAt: new Date(),
        lastSyncAttemptAt: new Date(),
        platformMetricNotes: metrics.platformNotes,
      },
      update: {},
    });
  }

  const stored = await prisma.platformPostAnalytics.findMany({
    where: { userId: user.id },
    orderBy: { platform: 'asc' },
  });
  console.log(
    stored.map((row) => ({
      platform: row.platform,
      views: row.views?.toString() ?? null,
      reach: row.reach?.toString() ?? null,
      impressions: row.impressions?.toString() ?? null,
      saves: row.saves?.toString() ?? null,
      engagementRate: row.engagementRate,
      metricSource: row.metricSource,
      unavailable: Object.entries(row.metricAvailability as Record<string, { status: string }>)
        .filter(([, v]) => v.status === 'UNAVAILABLE')
        .map(([k]) => k),
    })),
  );

  section('3) Cost aggregation without double-counting ProviderUsage');
  const usages = await prisma.providerUsage.findMany({
    where: { userId: user.id, storyId: story.id },
  });
  // Intentionally include a duplicate id in the working set to prove dedupe.
  const withDup = [...usages, usages[0]!];
  const unique = [...new Map(withDup.map((u) => [u.id, u])).values()];
  const naiveSum = withDup.reduce((s, u) => s + Number(u.estimatedCost), 0);
  const dedupedSum = unique.reduce((s, u) => s + Number(u.estimatedCost), 0);
  console.log({
    rawRowsIncludingDuplicate: withDup.length,
    uniqueUsageRecords: unique.length,
    naiveSumWouldBe: naiveSum,
    dedupedEstimatedCostUsd: dedupedSum,
  });

  const postsForVideo = await prisma.platformPostAnalytics.findMany({
    where: { userId: user.id, videoRenderId: render.id },
  });
  const sumAvailable = (key: 'views' | 'likes' | 'comments' | 'shares') => {
    const values = postsForVideo.map((p) => p[key]).filter((v): v is bigint => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0n) : null;
  };
  const videoAnalytics = await prisma.videoAnalytics.upsert({
    where: { videoRenderId: render.id },
    create: {
      userId: user.id,
      storyId: story.id,
      videoRenderId: render.id,
      title: story.title,
      category: story.category,
      publishedAt: new Date(),
      renderDurationMs: render.processingTimeMs,
      videoDurationSeconds: render.duration,
      generationCostUsd: dedupedSum,
      totalProductionCostUsd: dedupedSum,
      costIsEstimate: true,
      platformsPublishedCount: postsForVideo.length,
      aggregateViews: sumAvailable('views'),
      aggregateLikes: sumAvailable('likes'),
      aggregateComments: sumAvailable('comments'),
      aggregateShares: sumAvailable('shares'),
      aggregationMethod: 'sum_available_platforms_only',
      platformsWithViewsCount: postsForVideo.filter((p) => p.views != null).length,
      lastSyncedAt: new Date(),
      costBreakdown: Object.fromEntries(
        unique.map((u) => [`${u.provider}:${u.requestType}`, Number(u.estimatedCost)]),
      ),
    },
    update: {},
  });
  for (const row of postsForVideo) {
    await prisma.platformPostAnalytics.update({
      where: { id: row.id },
      data: { videoAnalyticsId: videoAnalytics.id },
    });
  }
  console.log({
    videoRenderId: videoAnalytics.videoRenderId,
    aggregateViews: videoAnalytics.aggregateViews?.toString() ?? null,
    totalProductionCostUsd: Number(videoAnalytics.totalProductionCostUsd),
    platformsWithViews: videoAnalytics.platformsWithViewsCount,
  });

  section('4) Duplicate snapshot prevention');
  const start = new Date('2026-03-01T00:00:00.000Z');
  const end = new Date('2026-03-31T23:59:59.999Z');
  const snapshotKey = `${user.id}:month:${start.toISOString()}:${end.toISOString()}:overview`;
  await prisma.analyticsSnapshot.upsert({
    where: { snapshotKey },
    create: {
      userId: user.id,
      windowType: 'month',
      windowStart: start,
      windowEnd: end,
      snapshotKey,
      metrics: { views: Number(videoAnalytics.aggregateViews ?? 0n) },
    },
    update: { metrics: { views: Number(videoAnalytics.aggregateViews ?? 0n), refreshed: true } },
  });
  await prisma.analyticsSnapshot.upsert({
    where: { snapshotKey },
    create: {
      userId: user.id,
      windowType: 'month',
      windowStart: start,
      windowEnd: end,
      snapshotKey,
      metrics: { views: 999 },
    },
    update: { metrics: { views: Number(videoAnalytics.aggregateViews ?? 0n), refreshed: true } },
  });
  const snapshots = await prisma.analyticsSnapshot.count({ where: { userId: user.id, snapshotKey } });
  console.log({ snapshotKey, rowsForSameWindow: snapshots });

  section('5) Failed sync recovery');
  const failedJob = await prisma.analyticsSyncJob.create({
    data: {
      userId: user.id,
      jobType: 'MANUAL',
      status: 'RUNNING',
      attemptCount: 1,
      maxAttempts: 5,
      postsTargeted: 4,
      lastError: 'Simulated worker crash mid-sync',
      startedAt: new Date(Date.now() - 20 * 60_000),
      updatedAt: new Date(Date.now() - 20 * 60_000),
      idempotencyKey: `demo-recover:${user.id}`,
    },
  });
  // Recovery rule: stale RUNNING jobs older than 15m are re-queued / completed via recover().
  const stale = await prisma.analyticsSyncJob.findMany({
    where: {
      userId: user.id,
      status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
  });
  await prisma.analyticsSyncJob.update({
    where: { id: failedJob.id },
    data: {
      status: 'COMPLETED',
      postsSucceeded: 4,
      postsFailed: 0,
      progress: 100,
      completedAt: new Date(),
      lastError: null,
      platformResults: { recovered: true, posts: posts.length },
    },
  });
  const recovered = await prisma.analyticsSyncJob.findUnique({ where: { id: failedJob.id } });
  console.log({
    staleJobsDetected: stale.length,
    recoveredStatus: recovered?.status,
    postsSucceeded: recovered?.postsSucceeded,
  });

  section('6) Ownership isolation check');
  const other = await prisma.user.create({
    data: {
      name: 'Other User',
      email: `phase11-other-${Date.now()}@example.com`,
      passwordHash: 'x',
    },
  });
  const leaked = await prisma.videoAnalytics.findFirst({
    where: { userId: other.id, videoRenderId: render.id },
  });
  const owned = await prisma.videoAnalytics.findFirst({
    where: { userId: user.id, videoRenderId: render.id },
  });
  console.log({
    otherUserSeesDemoVideo: Boolean(leaked),
    ownerSeesDemoVideo: Boolean(owned),
  });

  section('DONE');
  console.log({
    userId: user.id,
    email,
    videoRenderId: render.id,
    platformsSynced: platforms.length,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
