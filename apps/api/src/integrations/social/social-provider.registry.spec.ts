import { ConfigService } from '@nestjs/config';
import { FacebookProvider } from '../providers/facebook.provider';
import { InstagramProvider } from '../providers/instagram.provider';
import { TikTokProvider } from '../providers/tiktok.provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import { HttpClientService } from '../http-client.service';
import { SocialProviderRegistry } from './social-provider.registry';

describe('SocialProviderRegistry', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createRegistry() {
    const values: Record<string, unknown> = {
      'integrations.socialUseMock': 'true',
      'integrations.facebookUseMock': 'true',
      'integrations.instagramUseMock': 'true',
      'integrations.tiktokUseMock': 'true',
      'integrations.youtubeUseMock': 'true',
      'integrations.facebookGraphVersion': 'v22.0',
      'integrations.tiktokAudited': false,
    };

    const config = {
      get: <T = string>(key: string, defaultValue?: T) =>
        (values[key] as T | undefined) ?? defaultValue,
    } as ConfigService;

    const http = new HttpClientService();
    const facebook = new FacebookProvider(config, http);
    const instagram = new InstagramProvider(config, http);
    const tiktok = new TikTokProvider(config, http);
    const youtube = new YouTubeProvider(config, http);
    return new SocialProviderRegistry(facebook, instagram, tiktok, youtube);
  }

  it('lists all four platforms and resolves by key', () => {
    const registry = createRegistry();
    const listed = registry.list();
    expect(listed.map((p) => p.platform).sort()).toEqual([
      'FACEBOOK',
      'INSTAGRAM',
      'TIKTOK',
      'YOUTUBE',
    ]);
    expect(registry.get('FACEBOOK').platform).toBe('FACEBOOK');
    expect(registry.get('INSTAGRAM').platform).toBe('INSTAGRAM');
    expect(registry.get('TIKTOK').platform).toBe('TIKTOK');
    expect(registry.get('YOUTUBE').platform).toBe('YOUTUBE');
  });

  it('returns deterministic mock publish results for every provider without external HTTP', async () => {
    process.env.SOCIAL_USE_MOCK = 'true';
    const registry = createRegistry();

    for (const provider of registry.list()) {
      expect(provider.shouldUseMock()).toBe(true);

      const authUrl = provider.getAuthorizationUrl({
        state: 'test-state',
        redirectUri: 'http://localhost:3000/callback',
        codeChallenge: 'challenge',
      });
      expect(authUrl).toContain('state=test-state');

      const exchanged = await provider.exchangeAuthorizationCode({
        code: 'mock-code',
        redirectUri: 'http://localhost:3000/callback',
        codeVerifier: 'verifier',
      });
      expect(exchanged.tokens.accessToken).toBeTruthy();
      expect(exchanged.accounts.length).toBeGreaterThan(0);

      const account = exchanged.accounts[0]!;
      const caps = await provider.getPublishingCapabilities(
        exchanged.tokens.accessToken,
        account,
      );
      expect(caps.canPublishVideo).toBe(true);

      if (provider.platform === 'TIKTOK') {
        expect(caps.testOrPrivateOnly).toBe(true);
        expect(caps.canPublishPublic).toBe(false);
      }

      const published = await provider.publishVideo({
        accessToken: exchanged.tokens.accessToken,
        platformAccountId: account.platformAccountId,
        localFilePath: '/tmp/mock-video.mp4',
        title: 'Test',
        caption: 'Hello #test',
        hashtags: ['phase9'],
        platformSettings: { privacyStatus: 'private', privacyLevel: 'SELF_ONLY' },
      });

      expect(['published', 'processing']).toContain(published.phase);
      expect(published.raw).toMatchObject({ mock: true });

      const status = await provider.getPublishStatus({
        accessToken: exchanged.tokens.accessToken,
        platformAccountId: account.platformAccountId,
        providerUploadId: published.providerUploadId,
        providerPublishId: published.providerPublishId,
        providerPostId: published.providerPostId,
      });
      expect(status.phase).toBe('published');
      expect(status.requiresStatusPoll).toBe(false);
    }
  });
});
