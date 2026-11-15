import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  aspectRatioToImageSize,
  createMockPngBuffer,
  estimateFalImageCostUsd,
  getFalModelCapabilities,
  getFalPricingFromEnv,
} from '@ai-video/shared';
import { BaseProvider } from './base.provider';

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
  buffer?: Buffer;
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

@Injectable()
export class FalProvider extends BaseProvider {
  private readonly logger = new Logger(FalProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('integrations.falApiKey'));
  }

  shouldUseMock(): boolean {
    return (
      this.config.get<string>('integrations.falUseMock') === 'true' ||
      process.env.FAL_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  getModel(): string {
    return this.config.get<string>('integrations.falImageModel', 'fal-ai/flux/dev');
  }

  getCapabilities(model?: string) {
    return getFalModelCapabilities(model ?? this.getModel(), {
      FAL_IMAGE_MODEL: this.getModel(),
      FAL_IMAGE_SUPPORTS_REFERENCE: this.config.get<string>('integrations.falSupportsReference'),
      FAL_IMAGE_SUPPORTS_NEGATIVE_PROMPT: this.config.get<string>(
        'integrations.falSupportsNegativePrompt',
      ),
      FAL_IMAGE_DEFAULT_ASPECT_RATIO: this.config.get<string>(
        'integrations.falDefaultAspectRatio',
        '9:16',
      ),
    });
  }

  async generateImage(input: FalGenerateImageInput): Promise<FalGenerateImageResult> {
    const model = input.model ?? this.getModel();
    const capabilities = this.getCapabilities(model);
    const pricing = getFalPricingFromEnv({
      FAL_IMAGE_PRICE_PER_IMAGE: this.config.get<string>('integrations.falPricePerImage'),
      FAL_IMAGE_CURRENCY: this.config.get<string>('integrations.falCurrency'),
    });
    const numImages = input.numImages ?? 1;
    const aspectRatio =
      input.aspectRatio ??
      this.config.get<string>('integrations.falDefaultAspectRatio', '9:16');
    const imageSize =
      aspectRatioToImageSize(aspectRatio) ?? capabilities.defaultImageSize;

    const useReferences =
      Boolean(input.referenceImageUrls?.length) && capabilities.supportsReferenceImages;

    const parameters: Record<string, unknown> = {
      prompt: input.prompt,
      image_size: imageSize,
      num_images: numImages,
      output_format: this.config.get<string>('integrations.falDefaultFormat', 'png'),
      ...(input.seed !== undefined && capabilities.supportsSeed ? { seed: input.seed } : {}),
      ...(capabilities.supportsNegativePrompt && input.negativePrompt
        ? { negative_prompt: input.negativePrompt }
        : {}),
      ...(useReferences ? { reference_image_urls: input.referenceImageUrls } : {}),
    };

    if (this.shouldUseMock()) {
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

    const apiKey = this.assertConfigured(
      this.config.get<string>('integrations.falApiKey'),
      'FAL_API_KEY',
    );

    const timeoutMs = this.config.get<number>('integrations.falTimeoutMs', 120_000);
    const maxRetries = this.config.get<number>('integrations.falMaxRetries', 3);

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const queueResult = await this.submitAndWait(apiKey, model, parameters, timeoutMs);
        const images = await Promise.all(
          (queueResult.images ?? []).map(async (image) => {
            const buffer = await this.downloadImage(image.url, apiKey);
            return {
              url: image.url,
              width: image.width,
              height: image.height,
              contentType: image.content_type ?? 'image/jpeg',
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
        if (!this.isTransient(error) || attempt >= maxRetries) {
          break;
        }
        const delay = 500 * 2 ** (attempt - 1);
        this.logger.warn(`fal.ai attempt ${attempt} failed; retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('fal.ai image generation failed');
  }

  private async submitAndWait(
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
      // Some endpoints may return the result synchronously
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

  private async downloadImage(url: string, apiKey: string): Promise<Buffer> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      headers: url.includes('fal.media') || url.includes('fal.run')
        ? { Authorization: `Key ${apiKey}` }
        : undefined,
    });
    return Buffer.from(response.data);
  }

  private isTransient(error: unknown): boolean {
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
      message.includes('fetch failed')
    );
  }
}
