/**
 * Normalized analytics metric contracts.
 * Unavailable metrics must never be coerced to zero.
 */

export type MetricAvailabilityStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'NOT_SYNCED'
  | 'SYNC_FAILED'
  | 'ESTIMATED';

export type AnalyticsMetricSource =
  | 'PROVIDER_API'
  | 'MOCK'
  | 'ESTIMATED'
  | 'DERIVED'
  | 'UNAVAILABLE';

export type MetricKey =
  | 'views'
  | 'reach'
  | 'impressions'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'watchTimeSeconds'
  | 'averageWatchSeconds'
  | 'completionRate'
  | 'engagementRate'
  | 'followersGained';

export interface MetricAvailabilityEntry {
  status: MetricAvailabilityStatus;
  reason?: string;
  /** Platform-native metric name / definition */
  definition?: string;
  nativeName?: string;
}

export type MetricAvailabilityMap = Partial<Record<MetricKey, MetricAvailabilityEntry>>;

export type OptionalMetric<T = number> =
  | { status: 'AVAILABLE'; value: T; definition?: string; nativeName?: string }
  | { status: 'ESTIMATED'; value: T; definition?: string; nativeName?: string; reason?: string }
  | {
      status: 'UNAVAILABLE' | 'NOT_SYNCED' | 'SYNC_FAILED';
      value?: undefined;
      reason?: string;
      definition?: string;
      nativeName?: string;
    };

export function availableMetric<T>(
  value: T,
  extras?: { definition?: string; nativeName?: string },
): OptionalMetric<T> {
  return { status: 'AVAILABLE', value, ...extras };
}

export function unavailableMetric<T = number>(
  reason: string,
  extras?: { definition?: string; nativeName?: string; status?: 'UNAVAILABLE' | 'NOT_SYNCED' | 'SYNC_FAILED' },
): OptionalMetric<T> {
  return {
    status: extras?.status ?? 'UNAVAILABLE',
    reason,
    definition: extras?.definition,
    nativeName: extras?.nativeName,
  };
}

export function isMetricAvailable<T>(
  metric: OptionalMetric<T> | null | undefined,
): metric is Extract<OptionalMetric<T>, { status: 'AVAILABLE' | 'ESTIMATED' }> {
  return metric?.status === 'AVAILABLE' || metric?.status === 'ESTIMATED';
}

export function metricValueOrNull<T>(metric: OptionalMetric<T> | null | undefined): T | null {
  return isMetricAvailable(metric) ? metric.value : null;
}

export interface NormalizedPostMetrics {
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE';
  providerPostId: string;
  postUrl?: string | null;
  publishedAt?: string | null;
  views: OptionalMetric<number>;
  reach: OptionalMetric<number>;
  impressions: OptionalMetric<number>;
  likes: OptionalMetric<number>;
  comments: OptionalMetric<number>;
  shares: OptionalMetric<number>;
  saves: OptionalMetric<number>;
  watchTimeSeconds: OptionalMetric<number>;
  averageWatchSeconds: OptionalMetric<number>;
  completionRate: OptionalMetric<number>;
  followersGained: OptionalMetric<number>;
  metricSource: AnalyticsMetricSource;
  platformNotes: Record<string, string>;
  /** Truncated raw payload — callers must size-cap before persistence */
  raw?: Record<string, unknown>;
}

export const METRIC_DEFINITIONS = {
  engagementRate:
    'Engagement rate = (likes + comments + shares [+ saves when available]) / views. Only computed when views and all included engagement parts are available. Different platforms define engagement differently; do not mix rates across platforms without noting definitions.',
  averageViewsPerVideo:
    'Average of available view counts across videos that have at least one platform with AVAILABLE views. Videos with only unavailable view metrics are excluded from the denominator.',
  averageWatchDuration:
    'Average of available averageWatchSeconds values. Platforms without watch-time metrics are excluded.',
  videoCompletionRate:
    'Platform-native completion/full-watch rate when provided. Not estimated from other metrics.',
  viewsPerPublication:
    'Total AVAILABLE views divided by count of publications that reported AVAILABLE views.',
  engagementPerThousandViews:
    '((likes + comments + shares [+ saves]) / views) * 1000 when views > 0 and engagement parts are available.',
  costPerThousandViews:
    'Estimated production cost / (available views / 1000). Requires AVAILABLE views > 0.',
  costPerEngagement:
    'Estimated production cost / total AVAILABLE engagement actions. Requires engagement > 0.',
  costPerCompletedVideo:
    'Sum of ProviderUsage estimatedCost for stories with a COMPLETED VideoRender, divided by completed render count. Costs are estimates unless actual billing data exists.',
  costPerSuccessfulPublication:
    'Total estimated production cost of published videos / count of PUBLISHED PublishRecords. Estimate only.',
  facebookViews:
    'Facebook Page video_insights total_video_views: plays of at least ~3 seconds (or nearly full length if shorter). Requires pages_read_engagement / read_insights and Page ANALYZE task.',
  instagramViews:
    'Instagram media insights views (replaces deprecated video_views/plays/impressions). Requires instagram_manage_insights or equivalent insights permission on a Professional account.',
  tiktokViews:
    'TikTok Login Kit video.list view_count, or Business API video_views when video.list / video.insights scopes are granted.',
  youtubeViews:
    'YouTube Data API videos.list statistics.viewCount. Watch-time and average view duration require YouTube Analytics API (yt-analytics.readonly) which is optional and separate.',
} as const;

export const ANALYTICS_NOTIFICATION_TYPES = {
  SYNC_FAILURE: 'analytics.sync_failure',
  SPENDING_THRESHOLD: 'analytics.spending_threshold',
  MONTHLY_PROJECTION_EXCEEDED: 'analytics.monthly_projection_exceeded',
  EXPENSIVE_VIDEO: 'analytics.expensive_video',
  NEW_INSIGHTS: 'analytics.new_insights',
  PERMISSIONS_EXPIRED: 'analytics.permissions_expired',
} as const;

export const RAW_PROVIDER_RESPONSE_MAX_BYTES = 8_192;
