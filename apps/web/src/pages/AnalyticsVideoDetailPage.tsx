import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Film } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { MetricCard } from '@/components/analytics/MetricCard';
import { MetricValue } from '@/components/analytics/MetricValue';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import {
  dateTime,
  money,
  type PlatformAnalytics,
  type VideoAnalytics,
} from '@/lib/analytics';
import { statusTone } from '@/lib/status';

const platformMetrics: Array<[keyof PlatformAnalytics, string, 'number' | 'percent']> = [
  ['views', 'Views', 'number'],
  ['reach', 'Reach', 'number'],
  ['impressions', 'Impressions', 'number'],
  ['likes', 'Likes', 'number'],
  ['comments', 'Comments', 'number'],
  ['shares', 'Shares', 'number'],
  ['saves', 'Saves', 'number'],
  ['engagementRate', 'Engagement rate', 'percent'],
  ['completionRate', 'Completion rate', 'percent'],
];

export function AnalyticsVideoDetailPage() {
  const { videoId } = useParams();
  const video = useQuery({
    queryKey: ['analytics', 'video', videoId],
    enabled: Boolean(videoId),
    queryFn: async () =>
      (await api.get(`/analytics/videos/${videoId}`)).data.data as VideoAnalytics,
  });
  const platforms = useQuery({
    queryKey: ['analytics', 'video', videoId, 'platforms'],
    enabled: Boolean(videoId),
    queryFn: async () =>
      (await api.get(`/analytics/videos/${videoId}/platforms`)).data.data as PlatformAnalytics[],
  });

  if (video.isLoading || platforms.isLoading) return <LoadingState />;
  if (video.error || !video.data)
    return <ErrorState message="Failed to load video analytics" onRetry={() => void video.refetch()} />;

  const item = video.data;
  const costs = Object.entries(item.costBreakdown ?? {});

  return (
    <div className="space-y-6">
      <header>
        <Link className="mb-3 inline-flex items-center text-sm text-muted-foreground hover:text-foreground" to="/analytics">
          <ArrowLeft className="mr-1 h-4 w-4" /> Analytics
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{item.title ?? 'Untitled video'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Platform metrics are shown separately to avoid incompatible totals.</p>
          </div>
          <Badge tone={statusTone(item.performanceStatus)}>{item.performanceStatus}</Badge>
        </div>
      </header>

      {platforms.error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Video details loaded, but platform analytics are temporarily unavailable.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Aggregate views" value={item.aggregateViews} hint={`${item.platformsWithViewsCount}/${item.platformsPublishedCount} platforms covered`} />
        <MetricCard label="Aggregate engagement" value={item.aggregateEngagement} hint={`${item.platformsWithEngagementCount}/${item.platformsPublishedCount} platforms covered`} />
        <MetricCard label="Production cost" value={item.totalProductionCostUsd} format="money" estimated={item.costIsEstimate} />
        <MetricCard label="Video duration" value={item.videoDurationSeconds} format="text" hint="Seconds" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Story</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted-foreground">Story ID</dt><dd className="break-all font-medium">{item.storyId}</dd></div>
            <div><dt className="text-muted-foreground">Category</dt><dd>{item.category ?? 'Not set'}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Render</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted-foreground">Render ID</dt><dd className="break-all font-medium">{item.videoRenderId}</dd></div>
            <div><dt className="text-muted-foreground">Render duration</dt><dd>{item.renderDurationMs != null ? `${(item.renderDurationMs / 1000).toFixed(1)} seconds` : 'Unavailable'}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Timeline</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted-foreground">Created</dt><dd>{dateTime(item.createdAt)}</dd></div>
            <div><dt className="text-muted-foreground">Published</dt><dd>{dateTime(item.publishedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Last synced</dt><dd>{dateTime(item.lastSyncedAt)}</dd></div>
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Provider costs</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Generation" value={item.generationCostUsd} format="money" estimated />
          <MetricCard label="Rendering" value={item.renderingCostUsd} format="money" estimated />
          <MetricCard label="Total" value={item.totalProductionCostUsd} format="money" estimated={item.costIsEstimate} />
        </div>
        {costs.length > 0 && (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {costs.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{typeof value === 'number' ? money(value) : JSON.stringify(value)}</dd></div>)}
          </dl>
        )}
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold">Platform publications</h2><p className="text-xs text-muted-foreground">Definitions differ by platform; no cross-platform rate is calculated here.</p></div>
        {!platforms.data?.length ? (
          <EmptyState icon={Film} title="No platform metrics" description="Sync analytics after this video is published." />
        ) : platforms.data.map((post) => (
          <article key={post.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><h3 className="font-semibold">{post.platform}</h3><Badge>{post.metricSource}</Badge></div>
              {post.postUrl && <a className="inline-flex items-center text-sm text-muted-foreground hover:underline" href={post.postUrl} target="_blank" rel="noreferrer">Open post <ExternalLink className="ml-1 h-3 w-3" /></a>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Published {dateTime(post.publishedAt)} · last successful sync {dateTime(post.lastSuccessfulSyncAt)}</p>
            {post.lastSyncError && <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-300">Publication analytics error: {post.lastSyncError} ({post.syncFailCount} failed attempt{post.syncFailCount === 1 ? '' : 's'})</div>}
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {platformMetrics.map(([key, label, format]) => (
                <div key={key} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 font-semibold"><MetricValue value={post[key] as number | string | null} format={format} state={post.lastSyncError && post[key] == null ? 'sync-failed' : undefined} /></div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-lg border border-dashed bg-card/60 p-5">
        <h2 className="font-semibold">Performance over time</h2>
        <p className="mt-1 text-sm text-muted-foreground">Historical snapshots are not returned by the video analytics endpoints, so a trend chart is unavailable for this video.</p>
      </section>
    </div>
  );
}
