/**
 * Documented platform analytics capabilities based on official APIs (as of implementation).
 * Do not invent metrics beyond what these APIs expose.
 */

export interface PlatformAnalyticsCapability {
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE';
  accountTypes: string[];
  requiredPermissions: string[];
  optionalPermissions: string[];
  appReviewNotes: string[];
  postLevelMetrics: string[];
  accountLevelOnlyMetrics: string[];
  unavailableMetrics: string[];
  historicalAvailability: string;
  refreshLimitations: string;
  rateLimitNotes: string;
  endpoints: string[];
}

export const PLATFORM_ANALYTICS_CAPABILITIES: Record<
  'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE',
  PlatformAnalyticsCapability
> = {
  FACEBOOK: {
    platform: 'FACEBOOK',
    accountTypes: ['Facebook Page (Page access token with ANALYZE task)'],
    requiredPermissions: ['pages_read_engagement', 'pages_show_list'],
    optionalPermissions: ['read_insights', 'pages_manage_engagement'],
    appReviewNotes: [
      'pages_read_engagement typically requires App Review for production use beyond app admins/testers.',
      'Video insights require a Page token from a user who can perform ANALYZE on the Page.',
    ],
    postLevelMetrics: [
      'total_video_views',
      'total_video_views_unique (reach-like)',
      'total_video_avg_time_watched',
      'total_video_complete_views',
      'reactions/likes via object fields when available',
      'comments count via object fields when available',
      'shares count via object fields when available',
    ],
    accountLevelOnlyMetrics: ['Many Page Insights series are Page-level, not post-level'],
    unavailableMetrics: [
      'saves (not exposed for Page videos via video_insights)',
      'followersGained attributable to a single video (not reliably available per post)',
    ],
    historicalAvailability: 'Video insights generally available for ~2 years',
    refreshLimitations: 'Most insights update about once per 24 hours; do not poll aggressively',
    rateLimitNotes: 'Graph API rate limits apply (app + Page level). Use exponential backoff on 4xx/429.',
    endpoints: [
      'GET /{video-id}/video_insights?metric=...&period=lifetime',
      'GET /{video-id}?fields=likes.summary(true),comments.summary(true),shares',
    ],
  },
  INSTAGRAM: {
    platform: 'INSTAGRAM',
    accountTypes: ['Instagram Professional (Business or Creator)'],
    requiredPermissions: [
      'instagram_basic',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_manage_insights',
    ],
    optionalPermissions: ['instagram_business_manage_insights (Instagram Login path)'],
    appReviewNotes: [
      'Insights require Advanced Access / App Review for public users.',
      'Personal Instagram accounts do not support media insights.',
    ],
    postLevelMetrics: [
      'views (replaces deprecated video_views / plays / impressions)',
      'reach',
      'likes',
      'comments',
      'shares (Reels)',
      'saved',
      'ig_reels_avg_watch_time',
      'ig_reels_video_view_total_time',
      'total_interactions',
    ],
    accountLevelOnlyMetrics: ['Follower demographics and some profile metrics'],
    unavailableMetrics: [
      'impressions (deprecated Apr 2025 — use views)',
      'video_views / plays (deprecated — use views)',
    ],
    historicalAvailability: 'Lifetime insights are typically lifetime totals for the media object',
    refreshLimitations: 'Insights may lag; avoid sub-hourly polling',
    rateLimitNotes: 'Instagram Graph API rate limits; backoff on errors',
    endpoints: ['GET /{ig-media-id}/insights?metric=views,reach,likes,comments,saved,...'],
  },
  TIKTOK: {
    platform: 'TIKTOK',
    accountTypes: ['TikTok account authorized via Login Kit / Display API'],
    requiredPermissions: ['video.list'],
    optionalPermissions: [
      'user.info.basic',
      'video.insights (Business API path for watch time / completion)',
    ],
    appReviewNotes: [
      'video.list is required for Query Videos engagement fields.',
      'Deeper analytics (average_time_watched, full_video_watched_rate) need TikTok API for Business / video.insights and may require separate product approval.',
    ],
    postLevelMetrics: [
      'view_count',
      'like_count',
      'comment_count',
      'share_count',
      'collect_count / favorites (when returned)',
    ],
    accountLevelOnlyMetrics: ['user.insights daily account metrics'],
    unavailableMetrics: [
      'reach / average watch / completion via Login Kit alone — mark UNAVAILABLE unless Business API scopes granted',
      'followersGained per video',
    ],
    historicalAvailability:
      'Login Kit returns current totals for queried videos; Business post data may stop updating ~365 days after publish',
    refreshLimitations: 'Respect TikTok rate limits; some Business metrics lag 24–48h',
    rateLimitNotes: 'TikTok Open API QPS limits; exponential backoff',
    endpoints: [
      'POST https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count,...',
    ],
  },
  YOUTUBE: {
    platform: 'YOUTUBE',
    accountTypes: ['YouTube channel with OAuth'],
    requiredPermissions: ['https://www.googleapis.com/auth/youtube.readonly'],
    optionalPermissions: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
    appReviewNotes: [
      'youtube.readonly is sufficient for public statistics (views, likes, comments).',
      'Watch time / averageViewDuration require YouTube Analytics API and yt-analytics.readonly (separate verification).',
    ],
    postLevelMetrics: [
      'statistics.viewCount',
      'statistics.likeCount',
      'statistics.commentCount',
      'statistics.favoriteCount (legacy; often zero)',
    ],
    accountLevelOnlyMetrics: ['Many Analytics API reports are channel-dimensioned'],
    unavailableMetrics: [
      'shares (not in Data API statistics)',
      'reach / impressions (Analytics API; not fetched without yt-analytics scope)',
      'watchTime / averageViewDuration without Analytics API',
      'completionRate (not a native Data API field)',
      'followersGained per video',
    ],
    historicalAvailability: 'Data API returns current cumulative statistics',
    refreshLimitations: 'Statistics are eventually consistent; avoid aggressive polling',
    rateLimitNotes: 'YouTube Data API quota units; batch where possible',
    endpoints: [
      'GET https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=VIDEO_ID',
    ],
  },
};
