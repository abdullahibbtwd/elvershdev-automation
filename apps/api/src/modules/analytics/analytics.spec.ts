import { BadRequestException, NotFoundException } from '@nestjs/common';
import { availableMetric, unavailableMetric } from '@ai-video/shared';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsCostService } from './analytics-cost.service';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsMetricsService } from './analytics-metrics.service';
import { AnalyticsSyncService } from './analytics-sync.service';

describe('Phase 11 analytics', () => {
  it('calculates engagement, completion and cost without treating unavailable as zero', () => {
    const service = new AnalyticsMetricsService();
    expect(service.engagementRate({
      views: availableMetric(100),
      likes: availableMetric(5),
      comments: availableMetric(3),
      shares: availableMetric(2),
    }).value).toBe(0.1);
    expect(service.engagementRate({
      views: availableMetric(100),
      likes: unavailableMetric('permission'),
      comments: availableMetric(3),
      shares: availableMetric(2),
    }).value).toBeNull();
    expect(service.completionRate(40, 100).value).toBe(0.4);
    expect(service.costPerThousandViews(10, 5_000).value).toBe(2);
  });

  it('uses deterministic snapshot keys to prevent duplicates', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'snapshot' });
    const service = new AnalyticsAggregationService({
      analyticsSnapshot: { upsert },
    } as never);
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-02T00:00:00.000Z');
    await service.createSnapshot('user', 'day', start, end, { views: 1 });
    await service.createSnapshot('user', 'day', start, end, { views: 2 });
    expect(upsert.mock.calls[0][0].where.snapshotKey).toBe(upsert.mock.calls[1][0].where.snapshotKey);
  });

  it('deduplicates ProviderUsage by id before cost aggregation', async () => {
    const prisma = {
      providerUsage: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', provider: 'gemini', model: 'a', requestType: 'story', estimatedCost: 1, metadata: null, createdAt: new Date('2026-01-01') },
          { id: 'u1', provider: 'gemini', model: 'a', requestType: 'story', estimatedCost: 1, metadata: null, createdAt: new Date('2026-01-01') },
          { id: 'u2', provider: 'kling', model: 'b', requestType: 'video', estimatedCost: 3, metadata: null, createdAt: new Date('2026-01-02') },
        ]),
      },
    };
    const service = new AnalyticsCostService(prisma as never, {} as never, {} as never);
    const result = await service.summarize('user', new Date(0), new Date());
    expect(result.totalUsd).toBe(4);
    expect(result.usageRecordCount).toBe(2);
  });

  it('records partial status when some platform refreshes fail', async () => {
    const prisma = {
      analyticsSyncJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'job', userId: 'user' }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'job', ...data })),
      },
      analyticsOptimizationSettings: {
        upsert: jest.fn().mockResolvedValue({ syncRecentHours: 1, syncOlderHours: 2, recentPostMaxAgeDays: 7 }),
      },
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ok', publishedAt: new Date(), createdAt: new Date(), platformPostAnalytics: null },
          { id: 'bad', publishedAt: new Date(), createdAt: new Date(), platformPostAnalytics: null },
        ]),
      },
    };
    const notifications = { notify: jest.fn() };
    const service = new AnalyticsSyncService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, notifications as never,
    );
    jest.spyOn(service, 'refreshPost')
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('permission'));
    const result = await service.processSync({
      analyticsSyncJobId: 'job', userId: 'user', mode: 'manual', useMockAnalytics: true,
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.postsSucceeded).toBe(1);
    expect(result.postsFailed).toBe(1);
  });

  it('isolates sync job reads by owner', async () => {
    const service = new AnalyticsSyncService(
      { analyticsSyncJob: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    await expect(service.get('other-user', 'job')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid insights and insufficient sample sizes', async () => {
    const prisma = {
      analyticsOptimizationSettings: {
        upsert: jest.fn().mockResolvedValue({ insightLookbackDays: 90, minSampleSizeForOptimization: 10 }),
      },
      contentPerformanceSummary: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AnalyticsInsightsService(prisma as never, {} as never, {} as never);
    await expect(service.generate('user')).rejects.toBeInstanceOf(BadRequestException);
    expect(() => (service as any).validateGenerated({
      recommendation: 'This proves the category causes more views',
      supportingMetrics: {},
      sampleSize: 20,
      confidence: 'HIGH',
      suggestedExperiment: 'test',
      evidenceType: 'observational',
    }, 10)).toThrow('Causal claims');
  });

  it('uses deterministic mock analytics without provider calls', async () => {
    const post = {
      id: 'post', userId: 'user', providerPostId: 'provider-post', channelId: 'channel',
      platform: 'YOUTUBE', videoRenderId: null, publishedAt: new Date(), postUrl: null,
    };
    const aggregation = { persistPostMetrics: jest.fn().mockResolvedValue({ id: 'metrics' }) };
    const providers = { get: jest.fn() };
    const service = new AnalyticsSyncService(
      {
        analyticsSyncJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job', userId: 'user' }) },
        publishRecord: { findFirst: jest.fn().mockResolvedValue(post) },
      } as never,
      {} as never, {} as never, providers as never, aggregation as never, {} as never,
    );
    const result = await service.refreshPost({
      analyticsSyncJobId: 'job', userId: 'user', publishRecordId: 'post', useMockAnalytics: true,
    });
    expect(result).toEqual({ id: 'metrics' });
    expect(providers.get).not.toHaveBeenCalled();
    expect(aggregation.persistPostMetrics.mock.calls[0][2].metricSource).toBe('MOCK');
  });
});
