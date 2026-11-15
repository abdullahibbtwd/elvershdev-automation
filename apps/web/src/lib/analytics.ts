export type DatePreset =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_month'
  | 'previous_month'
  | 'custom';

export type RangeParams = { preset: DatePreset; from?: string; to?: string };

export type PlatformAnalytics = {
  id: string;
  platform: string;
  publishRecordId: string;
  providerPostId?: string | null;
  postUrl?: string | null;
  publishedAt?: string | null;
  views?: number | string | null;
  reach?: number | string | null;
  impressions?: number | string | null;
  likes?: number | string | null;
  comments?: number | string | null;
  shares?: number | string | null;
  saves?: number | string | null;
  watchTimeSeconds?: number | null;
  averageWatchSeconds?: number | null;
  completionRate?: number | null;
  engagementRate?: number | null;
  followersGained?: number | null;
  metricAvailability?: Record<string, { status?: string; reason?: string; definition?: string }>;
  metricSource: string;
  lastSuccessfulSyncAt?: string | null;
  lastSyncAttemptAt?: string | null;
  lastSyncError?: string | null;
  syncFailCount: number;
};

export type VideoAnalytics = {
  id: string;
  storyId: string;
  videoRenderId: string;
  title?: string | null;
  category?: string | null;
  publishedAt?: string | null;
  renderDurationMs?: number | null;
  videoDurationSeconds?: number | null;
  generationCostUsd: number | string;
  renderingCostUsd: number | string;
  totalProductionCostUsd: number | string;
  costIsEstimate: boolean;
  platformsPublishedCount: number;
  aggregateViews?: number | string | null;
  aggregateLikes?: number | string | null;
  aggregateComments?: number | string | null;
  aggregateShares?: number | string | null;
  aggregateEngagement?: number | string | null;
  aggregationMethod: string;
  platformsWithViewsCount: number;
  platformsWithEngagementCount: number;
  performanceStatus: string;
  lastSyncedAt?: string | null;
  costBreakdown?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  platformPosts?: PlatformAnalytics[];
};

export const money = (value: number | string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value));

export const compact = (value: number | string) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    Number(value),
  );

export const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not available';

export const queryParams = (range: RangeParams) => ({
  preset: range.preset,
  ...(range.preset === 'custom' ? { from: range.from, to: range.to } : {}),
});
