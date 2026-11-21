import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertVideoProviderSelectable,
  estimateHailuoVideoCostUsd,
  estimateKlingVideoCostUsd,
  estimateXaiVideoCostUsd,
  getDefaultVideoProviderId,
  getHailuoModelCapabilities,
  getKlingModelCapabilities,
  getXaiVideoModelCapabilities,
  isHailuoVideoProviderEnabled,
  isKlingVideoProviderEnabled,
  isXaiVideoProviderEnabled,
  normalizeVideoProviderId,
  type VideoGenerationProvider,
  type VideoProviderAvailability,
  type VideoProviderId,
} from '@ai-video/shared';
import { HailuoProvider } from '../providers/hailuo.provider';
import { KlingProvider } from '../providers/kling.provider';
import { XaiVideoProvider } from '../providers/xai-video.provider';

@Injectable()
export class VideoProviderRegistry {
  constructor(
    private readonly config: ConfigService,
    private readonly hailuo: HailuoProvider,
    private readonly kling: KlingProvider,
    private readonly xai: XaiVideoProvider,
  ) {}

  getDefaultProviderId(): VideoProviderId {
    return getDefaultVideoProviderId(process.env);
  }

  resolve(provider?: string | null): VideoGenerationProvider {
    const id = normalizeVideoProviderId(provider ?? this.getDefaultProviderId(), process.env);
    if (id === 'kling') return this.kling;
    if (id === 'xai') return this.xai;
    return this.hailuo;
  }

  resolveId(provider?: string | null): VideoProviderId {
    return normalizeVideoProviderId(provider ?? this.getDefaultProviderId(), process.env);
  }

  assertSelectable(provider: VideoProviderId): void {
    assertVideoProviderSelectable(provider, process.env);
  }

  listAvailability(): VideoProviderAvailability[] {
    const defaultId = this.getDefaultProviderId();
    return [
      this.describe('hailuo', defaultId),
      this.describe('kling', defaultId),
      this.describe('xai', defaultId),
    ];
  }

  estimateCost(
    provider: VideoProviderId,
    durationSeconds: number,
    resolution: string,
  ): number {
    if (provider === 'hailuo') {
      return estimateHailuoVideoCostUsd(durationSeconds, resolution, {
        pricePerSecond768PUsd: Number.parseFloat(
          this.config.get<string>('integrations.hailuoPricePerSecond768PUsd', '0.045'),
        ),
        pricePerSecond512PUsd: Number.parseFloat(
          this.config.get<string>('integrations.hailuoPricePerSecond512PUsd', '0.017'),
        ),
        currency: this.config.get<string>('integrations.hailuoCurrency', 'USD'),
      });
    }
    if (provider === 'xai') {
      return estimateXaiVideoCostUsd(durationSeconds, resolution, {
        pricePerSecond480PUsd: Number.parseFloat(
          this.config.get<string>('integrations.xaiVideoPricePerSecond480PUsd', '0.02'),
        ),
        pricePerSecond720PUsd: Number.parseFloat(
          this.config.get<string>('integrations.xaiVideoPricePerSecond720PUsd', '0.03'),
        ),
        pricePerSecond1080PUsd: Number.parseFloat(
          this.config.get<string>('integrations.xaiVideoPricePerSecond1080PUsd', '0.14'),
        ),
        currency: this.config.get<string>('integrations.xaiVideoCurrency', 'USD'),
      });
    }
    return estimateKlingVideoCostUsd(durationSeconds, resolution, {
      pricePerSecondUsd: Number.parseFloat(
        this.config.get<string>('integrations.klingPricePerSecondUsd', '0.07'),
      ),
      currency: this.config.get<string>('integrations.klingCurrency', 'USD'),
    });
  }

  getDefaultDuration(provider: VideoProviderId): number {
    if (provider === 'hailuo') {
      const value = this.config.get<number>('integrations.hailuoDefaultDuration', 6);
      return value === 10 ? 10 : 6;
    }
    if (provider === 'xai') {
      const value = this.config.get<number>('integrations.xaiVideoDefaultDuration', 8);
      if (Number.isFinite(value) && value >= 1 && value <= 15) return value;
      return 8;
    }
    const value = this.config.get<number>('integrations.klingDefaultDurationSeconds', 5);
    return value === 10 ? 10 : 5;
  }

  getDefaultResolution(provider: VideoProviderId): string {
    if (provider === 'hailuo') {
      const value = (
        this.config.get<string>('integrations.hailuoDefaultResolution', '768P') || '768P'
      ).toUpperCase();
      return value === '512P' ? '512P' : '768P';
    }
    if (provider === 'xai') {
      const value = (
        this.config.get<string>('integrations.xaiVideoResolution', '720p') || '720p'
      ).toLowerCase();
      if (value === '480p') return '480p';
      if (value === '1080p') return '1080p';
      return '720p';
    }
    const value = this.config.get<string>('integrations.klingDefaultResolution', '720p');
    return value === '1080p' ? '1080p' : '720p';
  }

  getModel(provider: VideoProviderId): string {
    return this.resolve(provider).getModel();
  }

  validateSettings(
    provider: VideoProviderId,
    durationSeconds: number,
    resolution: string,
  ): void {
    if (provider === 'hailuo') {
      const caps = getHailuoModelCapabilities(this.getModel(provider), process.env);
      if (!caps.supportedDurations.includes(durationSeconds as 6 | 10)) {
        throw new Error(
          `Hailuo does not support duration ${durationSeconds}s. Supported: ${caps.supportedDurations.join(', ')}`,
        );
      }
      const normalized = String(resolution).toUpperCase();
      if (!caps.supportedResolutions.includes(normalized as '512P' | '768P')) {
        throw new Error(
          `Hailuo does not support resolution ${resolution}. Supported: ${caps.supportedResolutions.join(', ')}`,
        );
      }
      return;
    }

    if (provider === 'xai') {
      const caps = getXaiVideoModelCapabilities(this.getModel(provider), process.env);
      if (!caps.supportedDurations.includes(durationSeconds)) {
        throw new Error(
          `xAI Lite does not support duration ${durationSeconds}s. Supported: 1–15 seconds`,
        );
      }
      const normalized = String(resolution).toLowerCase();
      if (!caps.supportedResolutions.includes(normalized as '480p' | '720p' | '1080p')) {
        throw new Error(
          `xAI Lite does not support resolution ${resolution}. Supported: ${caps.supportedResolutions.join(', ')}`,
        );
      }
      return;
    }

    const caps = getKlingModelCapabilities(this.getModel(provider), process.env);
    if (!caps.supportedDurations.includes(durationSeconds)) {
      throw new Error(
        `Kling does not support duration ${durationSeconds}s. Supported: ${caps.supportedDurations.join(', ')}`,
      );
    }
    if (!caps.supportedResolutions.includes(resolution as '720p' | '1080p')) {
      throw new Error(
        `Kling does not support resolution ${resolution}. Supported: ${caps.supportedResolutions.join(', ')}`,
      );
    }
  }

  private describe(
    id: VideoProviderId,
    defaultId: VideoProviderId,
  ): VideoProviderAvailability {
    const provider = this.resolve(id);
    const enabled =
      id === 'hailuo'
        ? isHailuoVideoProviderEnabled(process.env)
        : id === 'xai'
          ? isXaiVideoProviderEnabled(process.env)
          : isKlingVideoProviderEnabled(process.env);
    const configured = provider.isConfigured();
    const mockMode = provider.shouldUseMock();
    const duration = this.getDefaultDuration(id);
    const resolution = this.getDefaultResolution(id);
    const currency =
      id === 'hailuo'
        ? this.config.get<string>('integrations.hailuoCurrency', 'USD')
        : id === 'xai'
          ? this.config.get<string>('integrations.xaiVideoCurrency', 'USD')
          : this.config.get<string>('integrations.klingCurrency', 'USD');

    let unavailableReason: string | undefined;
    if (!enabled) {
      unavailableReason =
        id === 'kling'
          ? 'Kling is registered but disabled (set KLING_ENABLED=true to enable)'
          : id === 'xai'
            ? 'xAI Grok Lite is registered but disabled (set XAI_VIDEO_ENABLED=true to enable)'
            : 'Hailuo is disabled (HAILUO_ENABLED=false)';
    }

    const caps =
      id === 'hailuo'
        ? getHailuoModelCapabilities(provider.getModel(), process.env)
        : id === 'xai'
          ? getXaiVideoModelCapabilities(provider.getModel(), process.env)
          : getKlingModelCapabilities(provider.getModel(), process.env);

    return {
      id,
      displayName:
        id === 'hailuo'
          ? 'MiniMax Hailuo-02'
          : id === 'xai'
            ? 'xAI Grok Imagine Video 1.5 Lite'
            : 'Kling',
      default: id === defaultId,
      enabled,
      available: enabled,
      configured,
      mockMode,
      model: provider.getModel(),
      defaultDurationSeconds: duration,
      defaultResolution: resolution,
      supportedDurations: [...caps.supportedDurations],
      supportedResolutions: [...caps.supportedResolutions],
      estimatedCostPerDefaultClipUsd: this.estimateCost(id, duration, resolution),
      currency,
      unavailableReason,
    };
  }
}
