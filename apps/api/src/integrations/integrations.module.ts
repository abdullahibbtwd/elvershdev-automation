import { Module } from '@nestjs/common';
import { GeminiProvider } from './providers/gemini.provider';
import { FalProvider } from './providers/fal.provider';
import { KlingProvider } from './providers/kling.provider';
import { HailuoProvider } from './providers/hailuo.provider';
import { LipSyncProvider } from './providers/lip-sync.provider';
import { GeminiTtsProvider } from './providers/gemini-tts.provider';
import { FacebookProvider } from './providers/facebook.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { TikTokProvider } from './providers/tiktok.provider';
import { YouTubeProvider } from './providers/youtube.provider';
import { HttpClientService } from './http-client.service';
import { SocialProviderRegistry } from './social/social-provider.registry';
import { VideoProviderRegistry } from './video/video-provider.registry';

@Module({
  providers: [
    HttpClientService,
    GeminiProvider,
    FalProvider,
    KlingProvider,
    HailuoProvider,
    LipSyncProvider,
    GeminiTtsProvider,
    VideoProviderRegistry,
    FacebookProvider,
    InstagramProvider,
    TikTokProvider,
    YouTubeProvider,
    SocialProviderRegistry,
  ],
  exports: [
    HttpClientService,
    GeminiProvider,
    FalProvider,
    KlingProvider,
    HailuoProvider,
    LipSyncProvider,
    GeminiTtsProvider,
    VideoProviderRegistry,
    FacebookProvider,
    InstagramProvider,
    TikTokProvider,
    YouTubeProvider,
    SocialProviderRegistry,
  ],
})
export class IntegrationsModule {}
