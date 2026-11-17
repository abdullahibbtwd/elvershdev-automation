import type { LipSyncModelCapabilities, LipSyncProviderId } from './types';

/**
 * Capabilities sourced from published fal.ai model pages / API docs.
 * Do not invent fields that the API does not document.
 */
export const LIP_SYNC_CAPABILITIES: Record<LipSyncProviderId, LipSyncModelCapabilities> = {
  kling_avatar_v2_standard: {
    providerId: 'kling_avatar_v2_standard',
    endpointId: 'fal-ai/kling-video/ai-avatar/v2/standard',
    supportsAudioDrivenLipSync: true,
    supportsFacialExpressionFromAudio: true,
    supportsBodyMotionFromAudio: true,
    supportsOptionalPrompt: true,
    maxAudioSeconds: null,
    inputImageFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
    inputAudioFormats: ['mp3', 'ogg', 'wav', 'm4a', 'aac'],
    outputFormat: 'mp4',
    pricePerSecondUsd: 0.0562,
    notes: [
      'Audio-driven avatar animation; duration matches audio.',
      'Optional prompt refines motion; audio remains primary driver.',
      'Single subject per request — assemble multi-character scenes via shot cuts.',
    ],
  },
  kling_avatar_v2_pro: {
    providerId: 'kling_avatar_v2_pro',
    endpointId: 'fal-ai/kling-video/ai-avatar/v2/pro',
    supportsAudioDrivenLipSync: true,
    supportsFacialExpressionFromAudio: true,
    supportsBodyMotionFromAudio: true,
    supportsOptionalPrompt: true,
    maxAudioSeconds: null,
    inputImageFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
    inputAudioFormats: ['mp3', 'ogg', 'wav', 'm4a', 'aac'],
    outputFormat: 'mp4',
    pricePerSecondUsd: 0.115,
    notes: [
      'Higher fidelity lip sync than Standard at roughly 2x cost.',
      'Single subject per request.',
    ],
  },
  omnihuman: {
    providerId: 'omnihuman',
    endpointId: 'fal-ai/bytedance/omnihuman',
    supportsAudioDrivenLipSync: true,
    supportsFacialExpressionFromAudio: true,
    supportsBodyMotionFromAudio: true,
    supportsOptionalPrompt: false,
    maxAudioSeconds: 30,
    inputImageFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
    inputAudioFormats: ['mp3', 'ogg', 'wav', 'm4a', 'aac'],
    outputFormat: 'mp4',
    pricePerSecondUsd: 0.14,
    notes: [
      'Audio must be under 30 seconds per fal API docs.',
      'Published price ~$0.14 per second of output.',
    ],
  },
  mock: {
    providerId: 'mock',
    endpointId: 'mock://lip-sync',
    supportsAudioDrivenLipSync: true,
    supportsFacialExpressionFromAudio: false,
    supportsBodyMotionFromAudio: false,
    supportsOptionalPrompt: true,
    maxAudioSeconds: null,
    inputImageFormats: ['jpg', 'jpeg', 'png', 'webp'],
    inputAudioFormats: ['mp3', 'wav', 'm4a', 'aac'],
    outputFormat: 'mp4',
    pricePerSecondUsd: 0,
    notes: [
      'Deterministic placeholder for unit/integration tests only.',
      'Must never be reported as a real-provider lip-sync result.',
    ],
  },
};

export function getLipSyncCapabilities(
  providerId: LipSyncProviderId,
): LipSyncModelCapabilities {
  return LIP_SYNC_CAPABILITIES[providerId];
}

export function resolveLipSyncProviderId(
  env: Record<string, string | undefined> = {},
): LipSyncProviderId {
  if (env.LIP_SYNC_USE_MOCK === 'true' || env.NODE_ENV === 'test') {
    return 'mock';
  }
  const raw = (env.LIP_SYNC_PROVIDER ?? 'kling_avatar_v2_standard').trim();
  if (raw in LIP_SYNC_CAPABILITIES) {
    return raw as LipSyncProviderId;
  }
  return 'kling_avatar_v2_standard';
}
