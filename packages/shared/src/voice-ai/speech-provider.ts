import type { SpeechGenerationRequest } from './schemas';
import type { GeminiPrebuiltVoice } from './voices';

export interface SpeechGenerationResult {
  audioBytes: Uint8Array;
  mimeType: string;
  format: string;
  sampleRate: number;
  channels: number;
  /** Estimated or measured duration when known before ffprobe. */
  durationSeconds?: number;
  provider: string;
  model: string;
  voiceId: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd: number;
  /** True when generated via mock path (no paid provider call). */
  mocked: boolean;
}

export interface SpeechProviderVoice extends GeminiPrebuiltVoice {
  languageCodes?: string[];
  /** Preview audio is only included when the provider actually returns it. */
  previewAudioBase64?: string;
  previewMimeType?: string;
}

export interface SpeechGenerationProvider {
  readonly providerId: string;
  generateSpeech(request: SpeechGenerationRequest): Promise<SpeechGenerationResult>;
  listVoices(): Promise<SpeechProviderVoice[]>;
  estimateCost(text: string, estimatedDurationSeconds?: number): number;
  validateConfiguration(): { ok: boolean; message?: string };
}
