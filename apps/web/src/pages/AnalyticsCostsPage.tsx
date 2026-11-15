import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleDollarSign } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BarChart } from 'recharts';
import { ChartCard } from '@/components/analytics/ChartCard';
import {
  ChartFrame,
  PrimaryBar,
  ThemedGrid,
  ThemedTooltip,
  ThemedXAxis,
  ThemedYAxis,
  chartTheme,
} from '@/components/analytics/ChartPrimitives';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';
import { MetricCard } from '@/components/analytics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { money, queryParams, type RangeParams } from '@/lib/analytics';

type Recommendation = {
  type: string;
  stage?: string;
  provider?: string;
  costUsd?: number;
  usageRecords?: number;
};
type Summary = {
  totalUsd: number;
  usageRecordCount: number;
  isEstimate: boolean;
  byProvider: Record<string, number>;
  byStage: Record<string, number>;
  byDay: Record<string, number>;
  byMonth: Record<string, number>;
  recommendations: Recommendation[];
};
type Projection = {
  dailyUsd: number;
  monthlyUsd: number;
  projectedMonthlyUsd: number;
  monthlyLimitUsd: number | null;
  isEstimate: boolean;
};
type VideoCost = { videoRenderId: string; title?: string | null; costUsd: number; isEstimate: boolean };

const rows = (record: Record<string, number>, name: string) =>
  Object.entries(record).map(([key, cost]) => ({ [name]: key, cost }));

export function AnalyticsCostsPage() {
  const [range, setRange] = useState<RangeParams>({ preset: 'last_30_days' });
  const params = queryParams(range);
  const enabled = range.preset !== 'custom' || Boolean(range.from && range.to);
  const summary = useQuery({
    queryKey: ['analytics', 'costs', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/costs', { params })).data.data as Summary,
  });
  const providers = useQuery({
    queryKey: ['analytics', 'costs', 'providers', params],
    enabled,
    queryFn: async () =>
      (await api.get('/analytics/costs/providers', { params })).data.data as Array<{
        providerModel: string;
        costUsd: number;
      }>,
  });
  const videos = useQuery({
    queryKey: ['analytics', 'costs', 'videos', params],
    enabled,
    queryFn: async () => (await api.get('/analytics/costs/videos', { params })).data.data as VideoCost[],
  });
  const projection = useQuery({
    queryKey: ['analytics', 'costs', 'projection'],
    queryFn: async () => (await api.get('/analytics/costs/projection')).data.data as Projection,
  });

  if (summary.isLoading || projection.isLoading) return <LoadingState />;
  if (summary.error || !summary.data)
    return <ErrorState message="Failed to load cost analytics" onRetry={() => void summary.refetch()} />;

  const retry = summary.data.recommendations.find((item) => item.type === 'retry_cost');
  const average = videos.data?.length ? summary.data.totalUsd / videos.data.length : null;
  const budgetWarning =
    projection.data?.monthlyLimitUsd != null &&
    (projection.data.monthlyUsd >= projection.data.monthlyLimitUsd * 0.8 ||
      projection.data.projectedMonthlyUsd > projection.data.monthlyLimitUsd);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics costs"
        description="Provider usage estimates, projections, and optimization opportunities."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/analytics">
                <ArrowLeft className="h-4 w-4" /> Analytics
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/automation/settings">Automation budgets</Link>
            </Button>
          </>
        }
      />
      <DateRangeFilter value={range} onChange={setRange} />

      {budgetWarning && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-4 text-sm text-amber-200">
            <strong>Budget warning:</strong> monthly spend is approaching its limit or the projected
            spend exceeds it.
          </CardContent>
        </Card>
      )}
      {(providers.error || videos.error || projection.error) && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-3 text-sm text-amber-200">
            Some cost breakdowns are temporarily unavailable.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Daily spending" value={projection.data?.dailyUsd} format="money" estimated />
        <MetricCard label="Monthly spending" value={projection.data?.monthlyUsd} format="money" estimated />
        <MetricCard label="Range spending" value={summary.data.totalUsd} format="money" estimated />
        <MetricCard label="Average cost / video" value={average} format="money" estimated />
        <MetricCard
          label="Failed / retry costs"
          value={retry?.costUsd ?? null}
          format="money"
          estimated={Boolean(retry)}
          hint={retry ? `${retry.usageRecords} retry usage records` : 'No retry cost identified'}
        />
        <MetricCard label="Scheduled estimate" value={null} hint="Not returned by the costs API" />
        <MetricCard
          label="Monthly projection"
          value={projection.data?.projectedMonthlyUsd}
          format="money"
          estimated
        />
        <MetricCard label="Monthly budget" value={projection.data?.monthlyLimitUsd} format="money" />
      </div>

      {!summary.data.usageRecordCount ? (
        <EmptyState
          icon={CircleDollarSign}
          title="No cost data"
          description="Provider usage in the selected range will appear here."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Daily spending" description="Estimated provider cost.">
            <ChartFrame>
              <BarChart data={rows(summary.data.byDay, 'day')}>
                <ThemedGrid />
                <ThemedXAxis dataKey="day" />
                <ThemedYAxis />
                <ThemedTooltip formatter={(value) => money(Number(value))} />
                <PrimaryBar dataKey="cost" />
              </BarChart>
            </ChartFrame>
          </ChartCard>
          <ChartCard title="Monthly spending">
            <ChartFrame>
              <BarChart data={rows(summary.data.byMonth, 'month')}>
                <ThemedGrid />
                <ThemedXAxis dataKey="month" />
                <ThemedYAxis />
                <ThemedTooltip formatter={(value) => money(Number(value))} />
                <PrimaryBar dataKey="cost" fill={chartTheme.secondary} />
              </BarChart>
            </ChartFrame>
          </ChartCard>
          <ChartCard title="By provider and model">
            <ChartFrame>
              <BarChart data={providers.data ?? []}>
                <ThemedGrid />
                <ThemedXAxis dataKey="providerModel" />
                <ThemedYAxis />
                <ThemedTooltip formatter={(value) => money(Number(value))} />
                <PrimaryBar dataKey="costUsd" fill={chartTheme.tertiary} />
              </BarChart>
            </ChartFrame>
          </ChartCard>
          <ChartCard title="By stage">
            <ChartFrame>
              <BarChart data={rows(summary.data.byStage, 'stage')}>
                <ThemedGrid />
                <ThemedXAxis dataKey="stage" />
                <ThemedYAxis />
                <ThemedTooltip formatter={(value) => money(Number(value))} />
                <PrimaryBar dataKey="cost" />
              </BarChart>
            </ChartFrame>
          </ChartCard>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
          <CardDescription>Optimization signals from estimated provider usage.</CardDescription>
        </CardHeader>
        <CardContent>
          {!summary.data.recommendations.length ? (
            <p className="text-sm text-muted-foreground">No recommendations for this range.</p>
          ) : (
            <ul className="space-y-2">
              {summary.data.recommendations.map((item, index) => (
                <li
                  key={`${item.type}-${index}`}
                  className="rounded-lg border border-border p-3 text-sm transition-all duration-200 hover:border-primary/40"
                >
                  <Badge>{item.type.replaceAll('_', ' ')}</Badge>
                  <span className="ml-2 text-muted-foreground">
                    {item.stage ?? item.provider ?? `${item.usageRecords ?? 0} retry records`}
                    {item.costUsd != null && ` — ${money(item.costUsd)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Budget thresholds reuse Phase 10 AutomationConfig. All costs are provider usage estimates, not
        billing invoices.
      </p>
    </div>
  );
}
