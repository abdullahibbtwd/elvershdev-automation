import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fal } from '@fal-ai/client';
import axios, { AxiosError } from 'axios';
import {
  buildHailuoImageToVideoRequest,
  createMockMp4Buffer,
  estimateHailuoVideoCostUsd,
  getHailuoModelCapabilities,
  mapFalQueueStatusToVideoStatus,
  type ImageToVideoSubmitInput,
  type ImageToVideoSubmitResult,
  type RetrievedVideo,
  type VideoGenerationProvider,
  type VideoProviderTaskStatus,
  type VideoProviderTaskStatusResult,
} from '@ai-video/shared';
import { randomUUID } from 'node:crypto';
import { BaseProvider } from './base.provider';

const mockTaskStore = new Map<
  string,
  {
    status: VideoProviderTaskStatus;
    createdAt: number;
    durationSeconds: number;
    resolution: string;
    model: string;
  }
>();

@Injectable()
export class HailuoProvider extends BaseProvider implements VideoGenerationProvider {
  readonly name = 'hailuo';
  private readonly logger = new Logger(HailuoProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  shouldUseMock(forceMock?: boolean): boolean {
    if (forceMock) return true;
    return (
      this.config.get<string>('integrations.hailuoUseMock') === 'true' ||
      process.env.HAILUO_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  getModel(): string {
    return this.config.get<string>(
      'integrations.hailuoModel',
      'fal-ai/minimax/hailuo-02/standard/image-to-video',
    );
  }

  estimateCost(durationSeconds: number, resolution: string): number {
    return estimateHailuoVideoCostUsd(durationSeconds, resolution, {
      pricePerSecond768PUsd: Number.parseFloat(
        this.config.get<string>('integrations.hailuoPricePerSecond768PUsd', '0.045'),
      ),
      pricePerSecond512PUsd: Number.parseFloat(
        this.config.get<string>('integrations.hailuoPricePerSecond512PUsd', '0.017'),
      ),
      currency: this.config.get<string>('integrations.hailuoCurrency', 'USD'),
    });
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('integrations.falApiKey') ||
      process.env.FAL_API_KEY ||
      process.env.FAL_KEY ||
      undefined
    );
  }

  private configureClient(apiKey: string): void {
    fal.config({ credentials: apiKey });
  }

  private isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
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
      message.includes('unavailable')
    );
  }

  async submitImageToVideo(input: ImageToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
    const model = input.model ?? this.getModel();
    const capabilities = getHailuoModelCapabilities(model, {
      HAILUO_MODEL: model,
      HAILUO_DEFAULT_DURATION: String(
        this.config.get<number>('integrations.hailuoDefaultDuration', 6),
      ),
      HAILUO_DEFAULT_RESOLUTION: this.config.get<string>(
        'integrations.hailuoDefaultResolution',
        '768P',
      ),
      HAILUO_PROMPT_OPTIMIZER: this.config.get<string>(
        'integrations.hailuoPromptOptimizer',
        'true',
      ),
    });
    const durationSeconds = Number(input.durationSeconds) || capabilities.defaultDuration;
    const resolution = String(input.resolution || capabilities.defaultResolution);
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const currency = this.config.get<string>('integrations.hailuoCurrency', 'USD');

    if (this.shouldUseMock()) {
      const mockImageUrl = this.isHttpUrl(input.imageUrl)
        ? input.imageUrl
        : 'https://example.com/mock-hailuo-source.png';
      const validated = buildHailuoImageToVideoRequest({
        prompt: input.motionPrompt,
        imageUrl: mockImageUrl,
        durationSeconds,
        resolution,
        promptOptimizer:
          input.promptOptimizer ??
          this.config.get<string>('integrations.hailuoPromptOptimizer', 'true') !== 'false',
        endImageUrl: input.lastFrameUrl,
        model,
      });

      const providerTaskId = `mock-hailuo-${randomUUID()}`;
      mockTaskStore.set(providerTaskId, {
        status: 'submitted',
        createdAt: Date.now(),
        durationSeconds: validated.durationSeconds,
        resolution: validated.resolution,
        model: `mock:${validated.model}`,
      });
      return {
        providerTaskId,
        status: 'submitted',
        requestId: providerTaskId,
        estimatedCostUsd,
        currency,
        model: `mock:${validated.model}`,
        mock: true,
      };
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'FAL_API_KEY');
    this.configureClient(apiKey!);

    let imageUrl = input.imageUrl;
    if (!this.isHttpUrl(imageUrl)) {
      let bytes: Uint8Array | undefined = input.imageBytes;
      let mimeType = input.imageMimeType || 'image/png';
      if (!bytes && input.imageBase64) {
        const raw = input.imageBase64.startsWith('data:')
          ? input.imageBase64.slice(input.imageBase64.indexOf(',') + 1)
          : input.imageBase64;
        bytes = Buffer.from(raw, 'base64');
      }
      if (!bytes) {
        throw new Error('Hailuo requires a public image_url or image bytes for fal.storage upload');
      }
      const file = new File([bytes], `hailuo-source-${randomUUID()}.png`, { type: mimeType });
      imageUrl = await fal.storage.upload(file);
    }

    const validated = buildHailuoImageToVideoRequest({
      prompt: input.motionPrompt,
      imageUrl,
      durationSeconds,
      resolution,
      promptOptimizer:
        input.promptOptimizer ??
        this.config.get<string>('integrations.hailuoPromptOptimizer', 'true') !== 'false',
      endImageUrl: input.lastFrameUrl,
      model,
    });

    try {
      const submitted = await fal.queue.submit(validated.endpointId, {
        input: validated.body,
      });
      const requestId = (submitted as { request_id?: string }).request_id;
      if (!requestId) {
        throw new Error('Hailuo submit response missing request_id');
      }
      return {
        providerTaskId: requestId,
        status: 'submitted',
        requestId,
        estimatedCostUsd,
        currency,
        model: validated.model,
      };
    } catch (error) {
      if (this.isTransient(error)) {
        this.logger.warn(`Transient Hailuo submit error: ${(error as Error).message}`);
      }
      throw error;
    }
  }

  async getTaskStatus(providerTaskId: string): Promise<VideoProviderTaskStatusResult> {
    if (providerTaskId.startsWith('mock-hailuo-') || this.shouldUseMock()) {
      const existing = mockTaskStore.get(providerTaskId);
      if (!existing) {
        return {
          providerTaskId,
          status: 'failed',
          message: 'Unknown mock Hailuo task',
          outputs: [],
          mock: true,
        };
      }
      const readyAfter = this.config.get<number>('integrations.hailuoMockReadyAfterMs', 1500);
      const elapsed = Date.now() - existing.createdAt;
      const status: VideoProviderTaskStatus =
        elapsed >= readyAfter ? 'succeeded' : elapsed >= readyAfter / 2 ? 'processing' : 'submitted';
      return {
        providerTaskId,
        status,
        outputs:
          status === 'succeeded'
            ? [
                {
                  type: 'video',
                  url: `mock://hailuo/${providerTaskId}.mp4`,
                  duration: String(existing.durationSeconds),
                },
              ]
            : [],
        actualCostUsd: this.estimateCost(existing.durationSeconds, existing.resolution),
        currency: this.config.get<string>('integrations.hailuoCurrency', 'USD'),
        mock: true,
      };
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'FAL_API_KEY');
    this.configureClient(apiKey!);

    const endpointId = this.getModel();
    const statusResponse = await fal.queue.status(endpointId, {
      requestId: providerTaskId,
      logs: false,
    });
    const mapped = mapFalQueueStatusToVideoStatus(
      (statusResponse as { status?: string }).status,
    );

    if (mapped === 'succeeded') {
      const result = await fal.queue.result(endpointId, { requestId: providerTaskId });
      const videoUrl = (result as { data?: { video?: { url?: string } } }).data?.video?.url;
      if (!videoUrl) {
        throw new Error('Hailuo completed without a video URL');
      }
      return {
        providerTaskId,
        status: 'succeeded',
        outputs: [{ type: 'video', url: videoUrl }],
        currency: this.config.get<string>('integrations.hailuoCurrency', 'USD'),
      };
    }

    if (mapped === 'failed') {
      return {
        providerTaskId,
        status: 'failed',
        message:
          String(
            (statusResponse as { error?: string }).error ||
              (statusResponse as { message?: string }).message ||
              'Hailuo generation failed',
          ),
        outputs: [],
      };
    }

    return { providerTaskId, status: mapped, outputs: [] };
  }

  async retrieveCompletedVideo(
    result: VideoProviderTaskStatusResult,
  ): Promise<RetrievedVideo> {
    if (result.mock || result.outputs[0]?.url?.startsWith('mock://')) {
      const buffer = createMockMp4Buffer();
      return {
        buffer,
        mimeType: 'video/mp4',
        contentLength: buffer.length,
        sourceUrlHost: 'mock',
      };
    }

    const url = result.outputs[0]?.url;
    if (!url) {
      throw new Error('No completed Hailuo video URL available');
    }

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: this.config.get<number>('integrations.hailuoTimeoutMs', 600000),
      maxContentLength: 250 * 1024 * 1024,
    });

    const buffer = Buffer.from(response.data);
    return {
      buffer,
      mimeType:
        (response.headers['content-type'] as string | undefined)?.split(';')[0]?.trim() ||
        'video/mp4',
      contentLength: buffer.length,
      sourceUrlHost: (() => {
        try {
          return new URL(url).host;
        } catch {
          return undefined;
        }
      })(),
    };
  }

  async cancelTask(_providerTaskId: string): Promise<boolean> {
    return false;
  }
}
