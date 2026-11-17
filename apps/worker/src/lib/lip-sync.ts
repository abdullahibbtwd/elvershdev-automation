import { fal } from '@fal-ai/client';
import {
  estimateLipSyncCostUsd,
  getLipSyncCapabilities,
  resolveLipSyncProviderId,
  type LipSyncGenerateInput,
  type LipSyncGenerateResult,
  type LipSyncProviderId,
} from '@ai-video/shared';

function getFalApiKey(): string | undefined {
  return process.env.FAL_API_KEY || process.env.FAL_KEY || undefined;
}

export function shouldUseLipSyncMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.LIP_SYNC_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !getFalApiKey()
  );
}

export function getLipSyncProviderId(forceMock?: boolean): LipSyncProviderId {
  if (shouldUseLipSyncMock(forceMock)) return 'mock';
  return resolveLipSyncProviderId({
    LIP_SYNC_USE_MOCK: process.env.LIP_SYNC_USE_MOCK,
    LIP_SYNC_PROVIDER: process.env.LIP_SYNC_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
  });
}

export async function generateLipSyncVideo(
  input: LipSyncGenerateInput,
  options?: { forceMock?: boolean; durationHintSeconds?: number },
): Promise<LipSyncGenerateResult> {
  const providerId = getLipSyncProviderId(options?.forceMock);
  const caps = getLipSyncCapabilities(providerId);
  const durationHint = options?.durationHintSeconds ?? 4;

  if (providerId === 'mock') {
    return {
      videoUrl: `mock://lip-sync/${Date.now()}.mp4`,
      durationSeconds: durationHint,
      providerId: 'mock',
      endpointId: caps.endpointId,
      estimatedCostUsd: 0,
      currency: 'USD',
      mocked: true,
      raw: { mock: true },
    };
  }

  if (caps.maxAudioSeconds != null && durationHint > caps.maxAudioSeconds) {
    throw new Error(
      `${providerId} rejects audio longer than ${caps.maxAudioSeconds}s (hint=${durationHint}s)`,
    );
  }

  const apiKey = getFalApiKey();
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');
  fal.config({ credentials: apiKey });

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
    estimatedCostUsd: estimateLipSyncCostUsd(providerId, durationSeconds, {
      LIP_SYNC_PRICE_PER_SECOND_USD: process.env.LIP_SYNC_PRICE_PER_SECOND_USD,
    }),
    currency: 'USD',
    mocked: false,
    raw: data as Record<string, unknown>,
  };
}
