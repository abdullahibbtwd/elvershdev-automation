export const LIP_SYNC_PROVIDERS = [
  'kling_avatar_v2_standard',
  'kling_avatar_v2_pro',
  'omnihuman',
  'mock',
] as const;

export type LipSyncProviderId = (typeof LIP_SYNC_PROVIDERS)[number];

export interface LipSyncModelCapabilities {
  providerId: LipSyncProviderId;
  endpointId: string;
  supportsAudioDrivenLipSync: true;
  supportsFacialExpressionFromAudio: boolean;
  supportsBodyMotionFromAudio: boolean;
  supportsOptionalPrompt: boolean;
  maxAudioSeconds: number | null;
  inputImageFormats: string[];
  inputAudioFormats: string[];
  outputFormat: 'mp4';
  pricePerSecondUsd: number;
  notes: string[];
}

export interface LipSyncGenerateInput {
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
  /** Soft guidance only; providers may ignore. */
  emotion?: string;
  enableSafetyChecker?: boolean;
}

export interface LipSyncGenerateResult {
  videoUrl: string;
  durationSeconds?: number;
  providerId: LipSyncProviderId;
  endpointId: string;
  requestId?: string;
  estimatedCostUsd: number;
  currency: string;
  /** True when generated via mock path — must never be reported as a real lip-sync test. */
  mocked: boolean;
  raw?: Record<string, unknown>;
}

export interface LipSyncProvider {
  readonly providerId: LipSyncProviderId;
  getCapabilities(): LipSyncModelCapabilities;
  validateConfiguration(): { ok: boolean; message?: string };
  generate(input: LipSyncGenerateInput): Promise<LipSyncGenerateResult>;
  estimateCost(durationSeconds: number): number;
}
