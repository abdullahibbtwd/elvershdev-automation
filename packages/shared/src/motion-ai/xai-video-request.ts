/**
 * Official xAI Grok Imagine Video request/response helpers.
 * Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos
 * Model: grok-imagine-video-1.5-lite only for Series cinematic pipeline.
 */

export const XAI_VIDEO_LITE_MODEL = 'grok-imagine-video-1.5-lite' as const;
export const XAI_VIDEO_API_BASE_URL = 'https://api.x.ai/v1';
export const XAI_VIDEO_GENERATIONS_PATH = '/videos/generations';

export type XaiVideoResolution = '480p' | '720p' | '1080p';
export type XaiVideoAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'
  | '5:2';

export const XAI_VIDEO_SUPPORTED_RESOLUTIONS: XaiVideoResolution[] = ['480p', '720p', '1080p'];
export const XAI_VIDEO_SUPPORTED_ASPECT_RATIOS: XaiVideoAspectRatio[] = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
  '5:2',
];

/** One USD = 10_000_000_000 ticks (docs: 1 cent = 100_000_000 ticks). */
export const XAI_USD_TICKS_PER_DOLLAR = 10_000_000_000;

export interface XaiVideoImageInput {
  url?: string;
  file_id?: string | null;
}

export interface XaiVideoGenerationRequestBody {
  model: string;
  prompt?: string;
  duration?: number;
  resolution?: XaiVideoResolution;
  aspect_ratio?: XaiVideoAspectRatio;
  image?: XaiVideoImageInput;
  user?: string;
}

export interface XaiVideoGenerationSubmitResponse {
  request_id: string;
}

export interface XaiVideoPollError {
  code: string;
  message: string;
}

export interface XaiVideoPollUsage {
  cost_in_usd_ticks?: number;
  total_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export interface XaiVideoPollResult {
  status: string;
  progress?: number | null;
  model?: string | null;
  error?: XaiVideoPollError | null;
  usage?: XaiVideoPollUsage | null;
  video?: {
    url?: string | null;
    duration?: number;
    respect_moderation?: boolean;
    file_output?: {
      file_id?: string;
      filename?: string;
      public_url?: string | null;
    };
  } | null;
}

export function assertXaiLiteModel(model: string | undefined | null): string {
  const normalized = (model || XAI_VIDEO_LITE_MODEL).trim();
  if (normalized !== XAI_VIDEO_LITE_MODEL) {
    throw new Error(
      `Only ${XAI_VIDEO_LITE_MODEL} is allowed for xAI video generation (received: ${normalized}). ` +
        'Do not use grok-imagine-video-1.5 Full or other premium models.',
    );
  }
  return normalized;
}

export function normalizeXaiVideoResolution(
  resolution: string | undefined | null,
): XaiVideoResolution {
  const raw = String(resolution || '720p').trim().toLowerCase();
  if (raw === '480p' || raw === '480') return '480p';
  if (raw === '1080p' || raw === '1080') return '1080p';
  return '720p';
}

export function normalizeXaiVideoDuration(duration: number | string | undefined | null): number {
  const value =
    typeof duration === 'string' ? Number.parseInt(duration, 10) : Number(duration ?? 8);
  if (!Number.isFinite(value)) return 8;
  return Math.min(15, Math.max(1, Math.round(value)));
}

export function normalizeXaiAspectRatio(
  aspectRatio: string | undefined | null,
): XaiVideoAspectRatio {
  // Series Studio / social shorts default to vertical; xAI supports 9:16 natively.
  const raw = String(aspectRatio || '9:16').trim() as XaiVideoAspectRatio;
  if ((XAI_VIDEO_SUPPORTED_ASPECT_RATIOS as string[]).includes(raw)) return raw;
  return '9:16';
}

export function buildXaiTextToVideoRequest(input: {
  prompt: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  model?: string;
  user?: string;
}): XaiVideoGenerationRequestBody {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error('xAI text-to-video requires a non-empty prompt');
  }
  return {
    model: assertXaiLiteModel(input.model),
    prompt: prompt.slice(0, 4000),
    duration: normalizeXaiVideoDuration(input.durationSeconds),
    resolution: normalizeXaiVideoResolution(input.resolution),
    aspect_ratio: normalizeXaiAspectRatio(input.aspectRatio),
    ...(input.user ? { user: input.user } : {}),
  };
}

export function buildXaiImageToVideoRequest(input: {
  prompt?: string;
  imageUrl: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  model?: string;
  user?: string;
}): XaiVideoGenerationRequestBody {
  const imageUrl = input.imageUrl?.trim();
  if (!imageUrl) {
    throw new Error('xAI image-to-video requires an image URL or data URL');
  }
  const body: XaiVideoGenerationRequestBody = {
    model: assertXaiLiteModel(input.model),
    image: { url: imageUrl },
    duration: normalizeXaiVideoDuration(input.durationSeconds),
    resolution: normalizeXaiVideoResolution(input.resolution),
    // Always pin Series Studio clips to vertical 9:16 (default) so refs that are
    // square/landscape cannot silently produce 16:9 packs.
    aspect_ratio: normalizeXaiAspectRatio(input.aspectRatio ?? '9:16'),
    ...(input.user ? { user: input.user } : {}),
  };
  const prompt = input.prompt?.trim();
  if (prompt) {
    body.prompt = prompt.slice(0, 4000);
  }
  return body;
}

export function parseXaiSubmitResponse(data: unknown): XaiVideoGenerationSubmitResponse {
  const requestId =
    data && typeof data === 'object' && 'request_id' in data
      ? String((data as { request_id?: unknown }).request_id ?? '')
      : '';
  if (!requestId) {
    throw new Error('xAI video submit response missing request_id');
  }
  return { request_id: requestId };
}

export function mapXaiPollStatus(status: string | undefined | null):
  | 'submitted'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown' {
  switch ((status ?? '').toLowerCase()) {
    case 'pending':
    case 'queued':
    case 'submitted':
      return 'submitted';
    case 'processing':
    case 'in_progress':
      return 'processing';
    case 'done':
    case 'completed':
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

export function costUsdFromXaiTicks(ticks: number | undefined | null): number | undefined {
  if (ticks == null || !Number.isFinite(Number(ticks))) return undefined;
  return Number((Number(ticks) / XAI_USD_TICKS_PER_DOLLAR).toFixed(6));
}

export function parseXaiPollResponse(data: unknown): XaiVideoPollResult {
  if (!data || typeof data !== 'object') {
    throw new Error('xAI video poll response was empty');
  }
  return data as XaiVideoPollResult;
}

export function xaiVideoStatusUrl(requestId: string, baseUrl = XAI_VIDEO_API_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}/videos/${encodeURIComponent(requestId)}`;
}

export function xaiVideoGenerationsUrl(baseUrl = XAI_VIDEO_API_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}${XAI_VIDEO_GENERATIONS_PATH}`;
}
