import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, BarChart, LineChart } from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChartCard } from '@/components/analytics/ChartCard';
import {
  ChartFrame,
  ChartGradientDefs,
  PrimaryArea,
  PrimaryBar,
  PrimaryLine,
  ThemedGrid,
  ThemedLegend,
  ThemedTooltip,
  ThemedXAxis,
  ThemedYAxis,
  chartTheme,
} from '@/components/analytics/ChartPrimitives';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';
import { MetricCard } from '@/components/analytics/MetricCard';
import { MetricValue } from '@/components/analytics/MetricValue';
import { SyncStatusBanner, type SyncJob } from '@/components/analytics/SyncStatusBanner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  compact,
  dateTime,
  money,
  queryParams,
  type RangeParams,
  type VideoAnalytics,
} from '@/lib/analytics';
import { statusTone } from '@/lib/status';

type Overview = {
  range: { from: string; to: string };
  videos: number;
  videosGenerated?: number;
  videosPublished?: number;
  successfulPublications?: number;
  failedPublications?: number;
  totalViews: number | string | null;
  totalEngagement: number | string | null;
  totalCostUsd: number;
  averageCostPerVideoUsd?: number | null;
  costsAreEstimates?: boolean;
  aggregationNote?: string;
  bestPerformingVideo?: {
    videoRenderId: string;
    title?: string | null;
    aggregateViews?: number | string | null;
  } | null;
  bestPerformingPlatform?: {
    platform: string;
    totalViews: number | string;
    note?: string;
  } | null;
  lastSyncedAt?: string | null;
  coverage: { videosWithViews: number; videosWithEngagement: number };
};
type Trend = { date: string; views: number | null; engagement: number | null; posts: number };
type Platform = {
  platform: string;
  posts: number;
  totalViews: number | string | null;
  metricCoverage: { views: number };
};
type Costs = { byDay: Record<string, number> };

export function AnalyticsOverviewPage() {
  const client = useQueryClient();
  const [range, setRange] = useState<RangeParams>({ preset: 'last_30_days' });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'publishedAt' | 'views' | 'cost'>('publishedAt');
  const params = queryParams(range);
  const enabled = range.preset !== 'custom' || Boolean(range.from && range.to);

  const overview = useQuery({
    queryKey: ['analytics', 'overview', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/overview', { params })).data.data as Overview,
  });
  const trends = useQuery({
    queryKey: ['analytics', 'trends', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/trends', { params })).data.data as Trend[],
  });
  const platforms = useQuery({
    queryKey: ['analytics', 'platforms', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/platforms', { params })).data.data as Platform[],
  });
  const content = useQuery({
    queryKey: ['analytics', 'content', params, page],
    enabled,
    queryFn: async () => {
      const response = await api.get('/analytics/content', { params: { ...params, page, limit: 20 } });
      return {
        items: response.data.data as VideoAnalytics[],
        meta: response.data.meta as { page: number; totalPages: number; total: number },
      };
    },
  });
  const costs = useQuery({
    queryKey: ['analytics', 'costs', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/costs', { params })).data.data as Costs,
  });
  const sync = useQuery({
    queryKey: ['analytics', 'sync'],
    queryFn: async () => (await api.get('/analytics/sync')).data.data as SyncJob[],
    refetchInterval: 15000,
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      const queryMock =
        new globalThis.URLSearchParams(globalThis.location.search).get('useMockAnalytics') ===
        'true';
      return api.post('/analytics/sync', {
        useMockAnalytics: import.meta.env.VITE_USE_MOCK === 'true' || queryMock,
      });
    },
    onSuccess: () => {
      toast.success('Analytics sync queued');
      void client.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: () => toast.error('Unable to start analytics sync'),
  });

  const rows = useMemo(() => {
    const needle = filter.toLowerCase();
    return [...(content.data?.items ?? [])]
      .filter((item) => `${item.title ?? ''} ${item.category ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === 'views') return Number(b.aggregateViews ?? -1) - Number(a.aggregateViews ?? -1);
        if (sort === 'cost') return Number(b.totalProductionCostUsd) - Number(a.totalProductionCostUsd);
        return new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime();
      });
  }, [content.data, filter, sort]);
  const categoryData = useMemo(() => {
    const grouped: Record<string, number> = {};
    for (const item of content.data?.items ?? [])
      grouped[item.category ?? 'Uncategorized'] = (grouped[item.category ?? 'Uncategorized'] ?? 0) + 1;
    return Object.entries(grouped).map(([category, videos]) => ({ category, videos }));
  }, [content.data]);
  const costData = Object.entries(costs.data?.byDay ?? {}).map(([date, cost]) => ({ date, cost }));

  if ([overview, trends, platforms, content, costs].some((query) => query.isLoading))
    return <LoadingState />;
  if (overview.error || !overview.data)
    return <ErrorState message="Failed to load analytics overview" onRetry={() => void overview.refetch()} />;

  const partialFailure = [trends, platforms, content, costs].some((query) => query.error);
  const averageCost =
    overview.data.averageCostPerVideoUsd ??
    (overview.data.videos ? overview.data.totalCostUsd / overview.data.videos : null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Performance and estimated production cost reporting."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/analytics/costs">Costs</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/analytics/insights">Insights</Link>
            </Button>
            <Button disabled={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
              <RefreshCw className="h-4 w-4" /> Sync now
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter
          value={range}
          onChange={(next) => {
            setRange(next);
            setPage(1);
          }}
        />
        <span className="text-xs text-muted-foreground">
          Reporting {new Date(overview.data.range.from).toLocaleDateString()}–
          {new Date(overview.data.range.to).toLocaleDateString()}
          {overview.data.lastSyncedAt
            ? ` · Last synced ${new Date(overview.data.lastSyncedAt).toLocaleString()}`
            : ''}
        </span>
      </div>

      <SyncStatusBanner job={sync.data?.[0]} />

      {overview.data.aggregationNote && (
        <Card>
          <CardContent className="p-3 text-xs text-muted-foreground">
            {overview.data.aggregationNote}
          </CardContent>
        </Card>
      )}
      {partialFailure && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-3 text-sm text-amber-200">
            Some analytics sections could not be loaded. Available results are shown below.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Videos generated" value={overview.data.videosGenerated ?? null} />
        <MetricCard label="Videos published" value={overview.data.videosPublished ?? overview.data.videos} />
        <MetricCard label="Successful publications" value={overview.data.successfulPublications ?? null} />
        <MetricCard label="Failed publications" value={overview.data.failedPublications ?? null} />
        <MetricCard
          label="Total views"
          value={overview.data.totalViews}
          hint={`${overview.data.coverage.videosWithViews}/${overview.data.videos} videos covered`}
        />
        <MetricCard
          label="Engagement"
          value={overview.data.totalEngagement}
          hint={`${overview.data.coverage.videosWithEngagement}/${overview.data.videos} videos covered`}
        />
        <MetricCard label="Estimated spend" value={overview.data.totalCostUsd} format="money" estimated />
        <MetricCard label="Average cost / video" value={averageCost} format="money" estimated />
        <MetricCard
          label="Best video"
          value={overview.data.bestPerformingVideo?.aggregateViews ?? null}
          hint={overview.data.bestPerformingVideo?.title ?? 'No available view rankings'}
        />
        <MetricCard
          label="Best platform"
          value={overview.data.bestPerformingPlatform?.totalViews ?? null}
          hint={overview.data.bestPerformingPlatform?.platform ?? 'No available platform ranking'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Views over time">
          <ChartFrame>
            <AreaChart data={trends.data ?? []}>
              <ChartGradientDefs id="viewsFill" />
              <ThemedGrid />
              <ThemedXAxis dataKey="date" />
              <ThemedYAxis />
              <ThemedTooltip />
              <PrimaryArea dataKey="views" fillId="viewsFill" />
            </AreaChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard title="Engagement over time">
          <ChartFrame>
            <AreaChart data={trends.data ?? []}>
              <ChartGradientDefs id="engagementFill" color={chartTheme.tertiary} />
              <ThemedGrid />
              <ThemedXAxis dataKey="date" />
              <ThemedYAxis />
              <ThemedTooltip />
              <Area
                type="monotone"
                dataKey="engagement"
                stroke={chartTheme.tertiary}
                strokeWidth={2}
                fill="url(#engagementFill)"
                connectNulls={false}
                dot={false}
              />
            </AreaChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard title="Published over time">
          <ChartFrame>
            <BarChart data={trends.data ?? []}>
              <ThemedGrid />
              <ThemedXAxis dataKey="date" />
              <ThemedYAxis />
              <ThemedTooltip />
              <PrimaryBar dataKey="posts" />
            </BarChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard
          title="Performance by platform"
          description="Views remain unavailable where a platform did not return that metric."
        >
          <ChartFrame>
            <BarChart data={platforms.data ?? []}>
              <ThemedGrid />
              <ThemedXAxis dataKey="platform" />
              <ThemedYAxis />
              <ThemedTooltip />
              <ThemedLegend />
              <PrimaryBar dataKey="totalViews" />
              <PrimaryBar dataKey="posts" fill={chartTheme.secondary} />
            </BarChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard title="Videos by category" description="Current table page only.">
          <ChartFrame>
            <BarChart data={categoryData}>
              <ThemedGrid />
              <ThemedXAxis dataKey="category" />
              <ThemedYAxis />
              <ThemedTooltip />
              <PrimaryBar dataKey="videos" fill={chartTheme.secondary} />
            </BarChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard title="Costs over time" description="Estimated provider usage.">
          <ChartFrame>
            <LineChart data={costData}>
              <ThemedGrid />
              <ThemedXAxis dataKey="date" />
              <ThemedYAxis />
              <ThemedTooltip formatter={(value) => money(Number(value))} />
              <PrimaryLine dataKey="cost" color={chartTheme.tertiary} />
            </LineChart>
          </ChartFrame>
        </ChartCard>
        <ChartCard title="Cost per video" description="Current table page only; estimated.">
          <ChartFrame>
            <BarChart data={content.data?.items ?? []}>
              <ThemedGrid />
              <ThemedXAxis dataKey="title" hide />
              <ThemedYAxis />
              <ThemedTooltip formatter={(value) => money(Number(value))} />
              <PrimaryBar dataKey="totalProductionCostUsd" />
            </BarChart>
          </ChartFrame>
        </ChartCard>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Content performance</h2>
            <p className="text-xs text-muted-foreground">Sort and filter the current page of results.</p>
          </div>
          <div className="flex gap-2">
            <input
              className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground"
              placeholder="Filter title or category"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <Select
              className="w-[160px]"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              options={[
                { value: 'publishedAt', label: 'Newest' },
                { value: 'views', label: 'Most views' },
                { value: 'cost', label: 'Highest cost' },
              ]}
            />
          </div>
        </div>
        {!content.data?.items.length ? (
          <EmptyState
            icon={BarChart3}
            title="No analytics yet"
            description="Publish content and sync analytics to populate this report."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-secondary/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    {['Title', 'Category', 'Published', 'Platforms', 'Views', 'Engagement', 'Cost', 'Status'].map(
                      (label) => (
                        <th key={label} className="px-3 py-2 font-medium">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className="border-b border-border/70 last:border-0">
                      <td className="px-3 py-3 font-medium">
                        <Link
                          className="text-foreground transition-colors hover:text-primary"
                          to={`/analytics/videos/${item.videoRenderId}`}
                        >
                          {item.title ?? `Video ${item.videoRenderId.slice(0, 8)}`}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{item.category ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {dateTime(item.publishedAt)}
                      </td>
                      <td className="px-3 py-3">{item.platformsPublishedCount}</td>
                      <td className="px-3 py-3">
                        <MetricValue value={item.aggregateViews} />
                      </td>
                      <td className="px-3 py-3">
                        <MetricValue value={item.aggregateEngagement} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {money(item.totalProductionCostUsd)}{' '}
                        {item.costIsEstimate && <Badge tone="info">Est.</Badge>}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone(item.performanceStatus)}>{item.performanceStatus}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {content.data?.meta && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {compact(content.data.meta.total)} results · page {content.data.meta.page} of{' '}
              {content.data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= content.data.meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Metric definitions:</strong> aggregate views and engagement
          sum only available platform metrics; unavailable values are never treated as zero. Costs are
          estimates from provider usage, not invoices. Platform metrics may use incompatible definitions
          and should be compared within each platform.
        </CardContent>
      </Card>
    </div>
  );
}
