import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  createMockMp4Buffer,
  estimateKlingVideoCostUsd,
  getKlingModelCapabilities,
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
export class KlingProvider extends BaseProvider implements VideoGenerationProvider {
  readonly name = 'kling';
  private readonly logger = new Logger(KlingProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  shouldUseMock(forceMock?: boolean): boolean {
    if (forceMock) return true;
    return (
      this.config.get<string>('integrations.klingUseMock') === 'true' ||
      process.env.KLING_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  getModel(): string {
    return this.config.get<string>('integrations.klingModel', 'kling-2.6');
  }

  getBaseUrl(): string {
    return (
      this.config.get<string>('integrations.klingApiBaseUrl') ||
      'https://api-singapore.klingai.com'
    ).replace(/\/$/, '');
  }

  getCapabilities(model?: string) {
    return getKlingModelCapabilities(model ?? this.getModel(), {
      KLING_MODEL: this.getModel(),
      KLING_SUPPORTS_NEGATIVE_PROMPT: this.config.get<string>(
        'integrations.klingSupportsNegativePrompt',
      ),
      KLING_SUPPORTS_LAST_FRAME: this.config.get<string>(
        'integrations.klingSupportsLastFrame',
      ),
    });
  }

  estimateCost(durationSeconds: number, resolution: string): number {
    return estimateKlingVideoCostUsd(durationSeconds, resolution, {
      pricePerSecondUsd: Number.parseFloat(
        this.config.get<string>('integrations.klingPricePerSecondUsd', '0.07'),
      ),
      currency: this.config.get<string>('integrations.klingCurrency', 'USD'),
    });
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('integrations.klingApiKey') ||
      this.config.get<string>('integrations.klingAccessKey') ||
      undefined
    );
  }

  private mapStatus(status: string | undefined): VideoProviderTaskStatus {
    switch ((status ?? '').toLowerCase()) {
      case 'submitted':
        return 'submitted';
      case 'processing':
        return 'processing';
      case 'succeeded':
        return 'succeeded';
      case 'failed':
        return 'failed';
      case 'cancelled':
      case 'canceled':
        return 'cancelled';
      default:
        return 'unknown';
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
    const capabilities = this.getCapabilities(model);
    const durationSeconds = Number(input.durationSeconds) || 5;
    const resolution = String(input.resolution || '720p');
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const currency = this.config.get<string>('integrations.klingCurrency', 'USD');

    if (this.shouldUseMock()) {
      const providerTaskId = `mock-kling-${randomUUID()}`;
      mockTaskStore.set(providerTaskId, {
        status: 'submitted',
        createdAt: Date.now(),
        durationSeconds,
        resolution,
        model: `mock:${model}`,
      });
      return {
        providerTaskId,
        status: 'submitted',
        estimatedCostUsd,
        currency,
        model: `mock:${model}`,
        mock: true,
      };
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'KLING_API_KEY');

    const body = {
      contents: [
        {
          type: 'prompt',
          text: input.motionPrompt.slice(0, capabilities.maxPromptChars),
        },
        {
          type: 'first_frame',
          url: input.imageBase64
            ? input.imageBase64.startsWith('data:')
              ? input.imageBase64
              : `data:image/png;base64,${input.imageBase64}`
            : input.imageUrl,
        },
      ],
      settings: {
        audio: input.audio ?? 'off',
        resolution,
        duration: durationSeconds,
      },
      options: {
        ...(input.externalTaskId ? { external_task_id: input.externalTaskId } : {}),
        watermark_info: { enabled: false },
      },
    };

    const response = await axios.post(
      `${this.getBaseUrl()}${capabilities.submitPath}`,
      body,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.config.get<number>('integrations.klingTimeoutMs', 120000),
      },
    );

    if (response.data?.code !== 0 && response.data?.code !== undefined) {
      throw new Error(response.data?.message || `Kling submit failed (${response.data.code})`);
    }

    const taskId = response.data?.data?.id as string | undefined;
    if (!taskId) {
      throw new Error('Kling submit response missing task id');
    }

    return {
      providerTaskId: taskId,
      status: this.mapStatus(response.data?.data?.status),
      requestId: response.data?.request_id,
      estimatedCostUsd,
      currency,
      model,
    };
  }

  async getTaskStatus(providerTaskId: string): Promise<VideoProviderTaskStatusResult> {
    if (providerTaskId.startsWith('mock-kling-') || this.shouldUseMock()) {
      const existing = mockTaskStore.get(providerTaskId);
      if (!existing) {
        return {
          providerTaskId,
          status: 'failed',
          message: 'Unknown mock Kling task',
          outputs: [],
          mock: true,
        };
      }
      const readyAfter = this.config.get<number>('integrations.klingMockReadyAfterMs', 1500);
      const elapsed = Date.now() - existing.createdAt;
      const status: VideoProviderTaskStatus =
        elapsed >= readyAfter ? 'succeeded' : elapsed >= readyAfter / 2 ? 'processing' : 'submitted';
      return {
        providerTaskId,
        status,
        outputs:
          status === 'succeeded'
            ? [{ type: 'video', url: `mock://kling/${providerTaskId}.mp4`, duration: String(existing.durationSeconds) }]
            : [],
        actualCostUsd: this.estimateCost(existing.durationSeconds, existing.resolution),
        currency: this.config.get<string>('integrations.klingCurrency', 'USD'),
        mock: true,
      };
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'KLING_API_KEY');

    try {
      const response = await axios.get(`${this.getBaseUrl()}/tasks`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        params: { task_ids: providerTaskId },
        timeout: 30_000,
      });

      const task = Array.isArray(response.data?.data)
        ? response.data.data[0]
        : response.data?.data;

      const outputs = Array.isArray(task?.outputs)
        ? task.outputs
            .filter((item: { type?: string; url?: string }) => item?.type === 'video' && item.url)
            .map((item: { id?: string; url: string; watermark_url?: string; duration?: string }) => ({
              type: 'video' as const,
              id: item.id,
              url: item.url,
              watermarkUrl: item.watermark_url,
              duration: item.duration,
            }))
        : [];

      return {
        providerTaskId: String(task?.id ?? providerTaskId),
        status: this.mapStatus(task?.status),
        message: task?.message,
        outputs,
        billing: task?.billing,
      };
    } catch (error) {
      if (this.isTransient(error)) {
        this.logger.warn(`Transient Kling status error: ${(error as Error).message}`);
      }
      throw error;
    }
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
      throw new Error('No completed Kling video URL available');
    }

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: this.config.get<number>('integrations.klingTimeoutMs', 120000),
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
    // Official Kling image-to-video API does not document task cancellation.
    return false;
  }

  /** @deprecated Use submitImageToVideo */
  async generateVideo(_prompt: string): Promise<{ videoUrl?: string }> {
    this.logger.warn('generateVideo() is deprecated; use submitImageToVideo()');
    return {};
  }
}
