import {
  availableMetric,
  type NormalizedPostMetrics,
  type SocialPlatformKey,
  unavailableMetric,
} from '@ai-video/shared';

type AnalyticsPlatform = NormalizedPostMetrics['platform'];

function deterministicNumber(seed: string, minimum: number, spread: number): number {
  let hash = 2_166_136_261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return minimum + ((hash >>> 0) % spread);
}

export function mockPostAnalytics(
  platform: AnalyticsPlatform,
  providerPostId: string,
  postUrl?: string | null,
): NormalizedPostMetrics {
  const seed = `${platform}:${providerPostId}`;
  const views = deterministicNumber(`${seed}:views`, 1_000, 90_000);
  const reach = deterministicNumber(`${seed}:reach`, 700, Math.max(1, views - 700));
  const likes = deterministicNumber(`${seed}:likes`, 20, 2_000);
  const comments = deterministicNumber(`${seed}:comments`, 2, 250);
  const shares = deterministicNumber(`${seed}:shares`, 1, 180);
  const saves = deterministicNumber(`${seed}:saves`, 1, 300);
  const averageWatchSeconds = deterministicNumber(`${seed}:watch`, 5, 40);
  const unavailable = (reason: string) => unavailableMetric(reason);

  return {
    platform,
    providerPostId,
    postUrl: postUrl ?? mockPostUrl(platform, providerPostId),
    views: availableMetric(views, { nativeName: mockNativeName(platform, 'views') }),
    reach:
      platform === 'TIKTOK' || platform === 'YOUTUBE'
        ? unavailable(`${platform} reach requires additional analytics access.`)
        : availableMetric(reach, { nativeName: mockNativeName(platform, 'reach') }),
    impressions:
      platform === 'INSTAGRAM' || platform === 'TIKTOK' || platform === 'YOUTUBE'
        ? unavailable(
            platform === 'INSTAGRAM'
              ? 'Instagram impressions is deprecated for media insights; use views.'
              : `${platform} impressions requires additional analytics access.`,
          )
        : availableMetric(views + deterministicNumber(`${seed}:impressions`, 50, 2_000)),
    likes: availableMetric(likes),
    comments: availableMetric(comments),
    shares: availableMetric(shares),
    saves:
      platform === 'TIKTOK' || platform === 'YOUTUBE' || platform === 'FACEBOOK'
        ? unavailable(`${platform} does not expose post saves through this adapter.`)
        : availableMetric(saves),
    watchTimeSeconds:
      platform === 'TIKTOK' || platform === 'YOUTUBE'
        ? unavailable(`${platform} watch time requires additional analytics access.`)
        : availableMetric(views * averageWatchSeconds),
    averageWatchSeconds:
      platform === 'TIKTOK' || platform === 'YOUTUBE'
        ? unavailable(`${platform} average watch time requires additional analytics access.`)
        : availableMetric(averageWatchSeconds),
    completionRate: unavailable(
      `${platform} does not expose a completion rate through the configured mock capability.`,
    ),
    followersGained: unavailable(
      `${platform} does not expose post-attributed follower gains through this adapter.`,
    ),
    metricSource: 'MOCK',
    platformNotes: {
      mock: 'Deterministic test metrics derived from platform and provider post id.',
      views: 'Mock views follow the platform-native view label but are not real provider data.',
    },
    raw: { mock: true, seed },
  };
}

export function isAnalyticsPlatform(platform: SocialPlatformKey): platform is AnalyticsPlatform {
  return (
    platform === 'FACEBOOK' ||
    platform === 'INSTAGRAM' ||
    platform === 'TIKTOK' ||
    platform === 'YOUTUBE'
  );
}

function mockPostUrl(platform: AnalyticsPlatform, providerPostId: string): string {
  switch (platform) {
    case 'FACEBOOK':
      return `https://www.facebook.com/${providerPostId}`;
    case 'INSTAGRAM':
      return `https://www.instagram.com/reel/${providerPostId}/`;
    case 'TIKTOK':
      return `https://www.tiktok.com/@mock/video/${providerPostId}`;
    case 'YOUTUBE':
      return `https://www.youtube.com/watch?v=${providerPostId}`;
  }
}

function mockNativeName(platform: AnalyticsPlatform, metric: string): string {
  return `${platform.toLowerCase()}_${metric}`;
}
