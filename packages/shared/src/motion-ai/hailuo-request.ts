import {
  getHailuoModelCapabilities,
  normalizeHailuoDuration,
  normalizeHailuoResolution,
  type HailuoDuration,
  type HailuoResolution,
} from './model-capabilities';

export interface HailuoImageToVideoRequestInput {
  prompt: string;
  imageUrl: string;
  durationSeconds?: number | string;
  resolution?: string;
  promptOptimizer?: boolean;
  endImageUrl?: string;
  model?: string;
  env?: Record<string, string | undefined>;
}

export interface HailuoImageToVideoRequestBody {
  prompt: string;
  image_url: string;
  duration: '6' | '10';
  resolution: HailuoResolution;
  prompt_optimizer: boolean;
  end_image_url?: string;
}

export interface HailuoValidatedRequest {
  body: HailuoImageToVideoRequestBody;
  durationSeconds: HailuoDuration;
  resolution: HailuoResolution;
  model: string;
  endpointId: string;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Build and validate the exact fal.ai Hailuo-02 Standard image-to-video request body.
 * Does not invent unsupported parameters.
 */
export function buildHailuoImageToVideoRequest(
  input: HailuoImageToVideoRequestInput,
): HailuoValidatedRequest {
  const capabilities = getHailuoModelCapabilities(input.model, input.env);
  const prompt = input.prompt?.trim() ?? '';
  if (!prompt) {
    throw new Error('Hailuo prompt is required');
  }
  if (prompt.length > capabilities.maxPromptChars) {
    throw new Error(
      `Hailuo prompt exceeds max length of ${capabilities.maxPromptChars} characters`,
    );
  }

  const imageUrl = input.imageUrl?.trim() ?? '';
  if (!imageUrl) {
    throw new Error('Hailuo image_url is required');
  }
  if (!isHttpUrl(imageUrl) && !imageUrl.startsWith('mock://')) {
    throw new Error('Hailuo image_url must be a publicly reachable HTTP(S) URL');
  }

  const rawDuration =
    input.durationSeconds === undefined || input.durationSeconds === null
      ? capabilities.defaultDuration
      : typeof input.durationSeconds === 'string'
        ? Number.parseInt(input.durationSeconds, 10)
        : Number(input.durationSeconds);
  if (!capabilities.supportedDurations.includes(rawDuration as HailuoDuration)) {
    throw new Error(
      `Hailuo does not support duration ${rawDuration}s. Supported: ${capabilities.supportedDurations.join(', ')}`,
    );
  }
  const durationSeconds = normalizeHailuoDuration(rawDuration);

  const rawResolution = String(input.resolution ?? capabilities.defaultResolution).toUpperCase();
  if (!capabilities.supportedResolutions.includes(rawResolution as HailuoResolution)) {
    throw new Error(
      `Hailuo does not support resolution ${rawResolution}. Supported: ${capabilities.supportedResolutions.join(', ')}`,
    );
  }
  const resolution = normalizeHailuoResolution(rawResolution);

  const promptOptimizer =
    input.promptOptimizer ?? capabilities.defaultPromptOptimizer;

  const body: HailuoImageToVideoRequestBody = {
    prompt: prompt.slice(0, capabilities.maxPromptChars),
    image_url: imageUrl,
    duration: String(durationSeconds) as '6' | '10',
    resolution,
    prompt_optimizer: promptOptimizer,
  };

  const endImageUrl = input.endImageUrl?.trim();
  if (endImageUrl) {
    if (!capabilities.supportsEndImage) {
      throw new Error('Hailuo end_image_url is not supported for this endpoint');
    }
    if (resolution !== capabilities.endImageRequiresResolution) {
      throw new Error(
        `Hailuo end_image_url requires resolution ${capabilities.endImageRequiresResolution}`,
      );
    }
    if (!isHttpUrl(endImageUrl) && !endImageUrl.startsWith('mock://')) {
      throw new Error('Hailuo end_image_url must be a publicly reachable HTTP(S) URL');
    }
    body.end_image_url = endImageUrl;
  }

  return {
    body,
    durationSeconds,
    resolution,
    model: capabilities.modelId,
    endpointId: capabilities.endpointId,
  };
}

export function mapFalQueueStatusToVideoStatus(
  status: string | undefined,
): 'submitted' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown' {
  switch ((status ?? '').toUpperCase()) {
    case 'IN_QUEUE':
      return 'submitted';
    case 'IN_PROGRESS':
      return 'processing';
    case 'COMPLETED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}
