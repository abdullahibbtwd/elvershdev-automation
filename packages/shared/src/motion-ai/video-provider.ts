import type { KlingDuration, KlingResolution } from './schemas';

export type VideoProviderTaskStatus =
  | 'submitted'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface ImageToVideoSubmitInput {
  imageUrl: string;
  /** Optional base64 image when URL hosting is unavailable (Kling). Hailuo prefers HTTP(S) URLs. */
  imageBase64?: string;
  /** Optional raw image bytes for providers that can upload to their own temporary storage (Hailuo/fal). */
  imageBytes?: Uint8Array;
  imageMimeType?: string;
  motionPrompt: string;
  negativePrompt?: string;
  durationSeconds: KlingDuration | number;
  resolution: KlingResolution | string;
  model?: string;
  externalTaskId?: string;
  /** Prefer silent clips; narration/music added in later phases */
  audio?: 'off' | 'native';
  lastFrameUrl?: string;
  /** Hailuo prompt optimizer (default true when supported) */
  promptOptimizer?: boolean;
}

export interface ImageToVideoSubmitResult {
  providerTaskId: string;
  status: VideoProviderTaskStatus;
  externalTaskId?: string;
  requestId?: string;
  estimatedCostUsd: number;
  currency: string;
  model: string;
  mock?: boolean;
}

export interface VideoProviderTaskOutput {
  type: 'video';
  id?: string;
  url: string;
  watermarkUrl?: string;
  duration?: string | number;
}

export interface VideoProviderTaskStatusResult {
  providerTaskId: string;
  status: VideoProviderTaskStatus;
  message?: string;
  outputs: VideoProviderTaskOutput[];
  billing?: Array<Record<string, unknown>>;
  actualCostUsd?: number;
  currency?: string;
  raw?: unknown;
  mock?: boolean;
}

export interface RetrievedVideo {
  buffer: Uint8Array;
  mimeType: string;
  contentLength: number;
  sourceUrlHost?: string;
}

/**
 * Provider-agnostic image-to-video adapter.
 * Concrete providers (Kling, future vendors) implement this contract.
 */
export interface VideoGenerationProvider {
  readonly name: string;
  isConfigured(): boolean;
  shouldUseMock(forceMock?: boolean): boolean;
  getModel(): string;
  estimateCost(durationSeconds: number, resolution: string): number;
  submitImageToVideo(input: ImageToVideoSubmitInput): Promise<ImageToVideoSubmitResult>;
  getTaskStatus(providerTaskId: string): Promise<VideoProviderTaskStatusResult>;
  retrieveCompletedVideo(result: VideoProviderTaskStatusResult): Promise<RetrievedVideo>;
  cancelTask?(providerTaskId: string): Promise<boolean>;
}
