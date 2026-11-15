import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../http-client.service';
import { FacebookProvider } from '../providers/facebook.provider';
import { InstagramProvider } from '../providers/instagram.provider';
import { TikTokProvider } from '../providers/tiktok.provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import { mockPostAnalytics } from './mock-analytics';
import { RAW_PROVIDER_RESPONSE_MAX_BYTES, truncateRawProviderResponse } from './normalize';

describe('social analytics adapters', () => {
  const config = {
    get: (key: string, defaultValue?: unknown) => (key.endsWith('UseMock') ? true : defaultValue),
  } as ConfigService;
  const http = {} as HttpClientService;

  const providers = [
    ['FACEBOOK', new FacebookProvider(config, http), 'mock-fb-post'],
    ['INSTAGRAM', new InstagramProvider(config, http), 'mock-ig-post'],
    ['TIKTOK', new TikTokProvider(config, http), 'mock-tiktok-post'],
    ['YOUTUBE', new YouTubeProvider(config, http), 'mock-yt-post'],
  ] as const;

  it.each(providers)(
    'returns deterministic mock metrics for %s',
    async (platform, provider, providerPostId) => {
      const input = {
        accessToken: 'mock-token',
        platformAccountId: 'mock-account',
        providerPostId,
      };
      const first = await provider.getPostAnalytics(input);
      const second = await provider.getPostAnalytics(input);

      expect(first).toEqual(second);
      expect(first.platform).toBe(platform);
      expect(first.metricSource).toBe('MOCK');
      expect(first.views.status).toBe('AVAILABLE');
      expect(first.platformNotes).toBeTruthy();
    },
  );

  it('uses UNAVAILABLE rather than zero for unsupported metrics', () => {
    const tiktok = mockPostAnalytics('TIKTOK', 'mock-tiktok-unavailable');
    const youtube = mockPostAnalytics('YOUTUBE', 'mock-yt-unavailable');

    expect(tiktok.watchTimeSeconds).toMatchObject({ status: 'UNAVAILABLE' });
    expect(tiktok.saves).toMatchObject({ status: 'UNAVAILABLE' });
    expect(youtube.reach).toMatchObject({ status: 'UNAVAILABLE' });
    expect(youtube.completionRate).toMatchObject({ status: 'UNAVAILABLE' });
    expect('value' in youtube.reach).toBe(false);
  });

  it('caps oversized raw provider responses', () => {
    const raw = truncateRawProviderResponse({ payload: 'x'.repeat(20_000) });

    expect(raw.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(raw), 'utf8')).toBeLessThanOrEqual(
      RAW_PROVIDER_RESPONSE_MAX_BYTES,
    );
  });
});
