import { Injectable } from '@nestjs/common';
import type { SocialPlatformKey } from '@ai-video/shared';
import { FacebookProvider } from '../providers/facebook.provider';
import { InstagramProvider } from '../providers/instagram.provider';
import { TikTokProvider } from '../providers/tiktok.provider';
import { YouTubeProvider } from '../providers/youtube.provider';
import type { SocialPublishingProvider } from './social-publishing.types';

@Injectable()
export class SocialProviderRegistry {
  private readonly byPlatform: Map<SocialPlatformKey, SocialPublishingProvider>;

  constructor(
    facebook: FacebookProvider,
    instagram: InstagramProvider,
    tiktok: TikTokProvider,
    youtube: YouTubeProvider,
  ) {
    this.byPlatform = new Map<SocialPlatformKey, SocialPublishingProvider>([
      [facebook.platform, facebook],
      [instagram.platform, instagram],
      [tiktok.platform, tiktok],
      [youtube.platform, youtube],
    ]);
  }

  get(platform: SocialPlatformKey): SocialPublishingProvider {
    const provider = this.byPlatform.get(platform);
    if (!provider) {
      throw new Error(`No social publishing provider registered for platform ${platform}`);
    }
    return provider;
  }

  list(): SocialPublishingProvider[] {
    return [...this.byPlatform.values()];
  }
}
