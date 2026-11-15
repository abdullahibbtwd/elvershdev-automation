import axios, { type AxiosError } from 'axios';
import {
  aspectRatioToImageSize,
  createMockPngBuffer,
  estimateFalImageCostUsd,
  getFalModelCapabilities,
  getFalPricingFromEnv,
  type FalModelCapabilities,
} from '@ai-video/shared';

export interface FalGenerateImageInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  numImages?: number;
  referenceImageUrls?: string[];
  model?: string;
}

export interface FalGeneratedImage {
  url: string;
  width?: number;
  height?: number;
  contentType?: string;
  buffer: Buffer;
  mock?: boolean;
}

export interface FalGenerateImageResult {
  images: FalGeneratedImage[];
  model: string;
  seed?: number;
  requestId?: string;
  estimatedCostUsd: number;
  currency: string;
  usedReferenceImages: boolean;
  parameters: Record<string, unknown>;
}

export function shouldUseMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.FAL_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !process.env.FAL_API_KEY
  );
}

export function getFalModel(): string {
  return process.env.FAL_IMAGE_MODEL ?? 'fal-ai/flux/dev';
}

export function getFalCapabilities(model?: string): FalModelCapabilities {
  return getFalModelCapabilities(model ?? getFalModel(), process.env);
}

function getTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.FAL_IMAGE_TIMEOUT_MS ?? '120000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function getMaxRetries(): number {
  const parsed = Number.parseInt(process.env.FAL_IMAGE_MAX_RETRIES ?? '3', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return Math.min(parsed, 5);
}

function isTransientFalError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase?.() ?? '';
  const status = (error as AxiosError)?.response?.status;
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('timeout') ||
    message.includes('rate') ||
    message.includes('unavailable') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused')
  );
}

async function submitAndWait(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{
  images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
  seed?: number;
  requestId?: string;
}> {
  const submitUrl = `https://queue.fal.run/${model}`;
  const submit = await axios.post(submitUrl, body, {
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: Math.min(timeoutMs, 30_000),
  });

  const requestId = submit.data?.request_id as string | undefined;
  const statusUrl = submit.data?.status_url as string | undefined;
  const responseUrl = submit.data?.response_url as string | undefined;

  if (!requestId || !statusUrl || !responseUrl) {
    if (Array.isArray(submit.data?.images)) {
      return { images: submit.data.images, seed: submit.data.seed, requestId };
    }
    throw new Error('fal.ai queue submit response missing status URLs');
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await axios.get(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      params: { logs: 0 },
      timeout: 15_000,
    });

    const state = status.data?.status as string | undefined;
    if (state === 'COMPLETED') {
      const result = await axios.get(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        timeout: 30_000,
      });
      return {
        images: result.data?.images,
        seed: result.data?.seed,
        requestId,
      };
    }
    if (state === 'FAILED') {
      throw new Error(status.data?.error || 'fal.ai generation failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`fal.ai generation timed out after ${timeoutMs}ms`);
}

async function downloadImage(url: string, apiKey: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers:
      url.includes('fal.media') || url.includes('fal.run')
        ? { Authorization: `Key ${apiKey}` }
        : undefined,
  });
  return Buffer.from(response.data);
}

export async function generateImage(
  input: FalGenerateImageInput,
  options?: { forceMock?: boolean },
): Promise<FalGenerateImageResult> {
  const model = input.model ?? getFalModel();
  const capabilities = getFalCapabilities(model);
  const pricing = getFalPricingFromEnv(process.env);
  const numImages = input.numImages ?? 1;
  const aspectRatio =
    input.aspectRatio ?? process.env.FAL_IMAGE_DEFAULT_ASPECT_RATIO ?? '9:16';
  const imageSize = aspectRatioToImageSize(aspectRatio) ?? capabilities.defaultImageSize;

  const useReferences =
    Boolean(input.referenceImageUrls?.length) && capabilities.supportsReferenceImages;

  const parameters: Record<string, unknown> = {
    prompt: input.prompt,
    image_size: imageSize,
    num_images: numImages,
    output_format: process.env.FAL_IMAGE_DEFAULT_FORMAT ?? 'png',
    ...(input.seed !== undefined && capabilities.supportsSeed ? { seed: input.seed } : {}),
    ...(capabilities.supportsNegativePrompt && input.negativePrompt
      ? { negative_prompt: input.negativePrompt }
      : {}),
    ...(useReferences ? { reference_image_urls: input.referenceImageUrls } : {}),
  };

  if (shouldUseMock(options?.forceMock)) {
    const buffer = Buffer.from(createMockPngBuffer());
    return {
      images: [
        {
          url: 'mock://fal/image.png',
          width: typeof imageSize === 'object' ? imageSize.width : 576,
          height: typeof imageSize === 'object' ? imageSize.height : 1024,
          contentType: 'image/png',
          buffer,
          mock: true,
        },
      ],
      model: `mock:${model}`,
      seed: input.seed ?? 42,
      estimatedCostUsd: estimateFalImageCostUsd(numImages, pricing),
      currency: pricing.currency,
      usedReferenceImages: useReferences,
      parameters,
    };
  }

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error('FAL_API_KEY is not configured');
  }

  const timeoutMs = getTimeoutMs();
  const maxRetries = getMaxRetries();

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const queueResult = await submitAndWait(apiKey, model, parameters, timeoutMs);
      const images = await Promise.all(
        (queueResult.images ?? []).map(async (image) => {
          const buffer = await downloadImage(image.url, apiKey);
          return {
            url: image.url,
            width: image.width,
            height: image.height,
            contentType: image.content_type ?? 'image/png',
            buffer,
          } satisfies FalGeneratedImage;
        }),
      );

      if (images.length === 0) {
        throw new Error('fal.ai returned no images');
      }

      return {
        images,
        model,
        seed: queueResult.seed,
        requestId: queueResult.requestId,
        estimatedCostUsd: estimateFalImageCostUsd(images.length, pricing),
        currency: pricing.currency,
        usedReferenceImages: useReferences,
        parameters,
      };
    } catch (error) {
      lastError = error;
      if (!isTransientFalError(error) || attempt >= maxRetries) {
        break;
      }
      const delay = Math.min(10_000, 500 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('fal.ai image generation failed');
}
