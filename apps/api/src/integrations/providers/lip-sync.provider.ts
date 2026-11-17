import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fal } from '@fal-ai/client';
import {
  estimateLipSyncCostUsd,
  getLipSyncCapabilities,
  resolveLipSyncProviderId,
  type LipSyncGenerateInput,
  type LipSyncGenerateResult,
  type LipSyncProviderId,
} from '@ai-video/shared';
import { BaseProvider } from './base.provider';
import {
  downloadUrlToBuffer,
  uploadBytesToFalStorage,
} from './fal-storage.util';

@Injectable()
export class LipSyncProvider extends BaseProvider {
  private readonly logger = new Logger(LipSyncProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  resolveProviderId(forceMock?: boolean): LipSyncProviderId {
    if (forceMock) return 'mock';
    return resolveLipSyncProviderId({
      LIP_SYNC_USE_MOCK: this.config.get<string>('integrations.lipSyncUseMock'),
      LIP_SYNC_PROVIDER: this.config.get<string>('integrations.lipSyncProvider'),
      NODE_ENV: process.env.NODE_ENV,
      FAL_API_KEY: this.getApiKey(),
    });
  }

  getApiKey(): string | undefined {
    return (
      this.config.get<string>('integrations.falApiKey') ||
      process.env.FAL_API_KEY ||
      process.env.FAL_KEY ||
      undefined
    );
  }

  shouldUseMock(forceMock?: boolean): boolean {
    if (forceMock) return true;
    if (this.config.get<string>('integrations.lipSyncUseMock') === 'true') return true;
    if (process.env.LIP_SYNC_USE_MOCK === 'true') return true;
    if (process.env.NODE_ENV === 'test') return true;
    return !this.getApiKey();
  }

  validateConfiguration(forceMock?: boolean): { ok: boolean; message?: string } {
    if (this.shouldUseMock(forceMock)) {
      return { ok: true, message: 'Using mock lip-sync provider' };
    }
    if (!this.getApiKey()) {
      return { ok: false, message: 'FAL_API_KEY is required for lip-sync generation' };
    }
    return { ok: true };
  }

  estimateCost(durationSeconds: number, providerId?: LipSyncProviderId): number {
    const id = providerId ?? this.resolveProviderId();
    return estimateLipSyncCostUsd(id, durationSeconds, {
      LIP_SYNC_PRICE_PER_SECOND_USD: this.config.get<string>(
        'integrations.lipSyncPricePerSecondUsd',
      ),
    });
  }

  async uploadMediaBytes(
    bytes: Uint8Array | Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'FAL_API_KEY');
    return uploadBytesToFalStorage({
      apiKey: apiKey!,
      bytes,
      fileName,
      mimeType,
    });
  }

  async downloadResult(url: string): Promise<Buffer> {
    return downloadUrlToBuffer(url);
  }

  async generate(
    input: LipSyncGenerateInput,
    options?: { forceMock?: boolean; durationHintSeconds?: number },
  ): Promise<LipSyncGenerateResult> {
    const forceMock = options?.forceMock === true;
    if (forceMock) {
      const caps = getLipSyncCapabilities('mock');
      return {
        videoUrl: `mock://lip-sync/${Date.now()}.mp4`,
        durationSeconds: options?.durationHintSeconds ?? 4,
        providerId: 'mock',
        endpointId: caps.endpointId,
        estimatedCostUsd: 0,
        currency: 'USD',
        mocked: true,
        raw: { mock: true },
      };
    }

    // Real path: never silently fall back to mock when LIP_SYNC_USE_MOCK is false.
    if (this.shouldUseMock(false)) {
      throw new Error(
        'Lip-sync is configured for mock mode (LIP_SYNC_USE_MOCK=true, missing FAL_API_KEY, or NODE_ENV=test). Refusing silent mock for real-provider requests.',
      );
    }

    const providerId = this.resolveProviderId(false);
    if (providerId === 'mock') {
      throw new Error('Lip-sync provider resolved to mock unexpectedly during real run');
    }
    const caps = getLipSyncCapabilities(providerId);
    const durationHint = options?.durationHintSeconds ?? 4;

    if (caps.maxAudioSeconds != null && durationHint > caps.maxAudioSeconds) {
      throw new Error(
        `${providerId} rejects audio longer than ${caps.maxAudioSeconds}s (hint=${durationHint}s)`,
      );
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'FAL_API_KEY');
    fal.config({ credentials: apiKey! });

    const falInput: Record<string, unknown> = {
      image_url: input.imageUrl,
      audio_url: input.audioUrl,
    };
    if (caps.supportsOptionalPrompt) {
      falInput.prompt =
        input.prompt?.trim() ||
        (input.emotion ? `Character speaking with a ${input.emotion} expression.` : '.');
      falInput.enable_safety_checker = input.enableSafetyChecker ?? true;
    }

    this.logger.log(`Lip-sync REAL submit provider=${providerId} endpoint=${caps.endpointId}`);

    const result = await fal.subscribe(caps.endpointId, {
      input: falInput,
      logs: false,
    });

    const data = (result.data ?? {}) as {
      video?: { url?: string };
      duration?: number;
    };
    const videoUrl = data.video?.url;
    if (!videoUrl) {
      throw new Error(`Lip-sync provider ${providerId} returned no video URL`);
    }

    const durationSeconds =
      typeof data.duration === 'number' && Number.isFinite(data.duration)
        ? data.duration
        : durationHint;

    return {
      videoUrl,
      durationSeconds,
      providerId,
      endpointId: caps.endpointId,
      requestId: result.requestId,
      estimatedCostUsd: this.estimateCost(durationSeconds, providerId),
      currency: 'USD',
      mocked: false,
      raw: data as Record<string, unknown>,
    };
  }
}
