import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  assertXaiLiteModel,
  buildXaiImageToVideoRequest,
  buildXaiTextToVideoRequest,
  costUsdFromXaiTicks,
  createMockMp4Buffer,
  estimateXaiVideoCostUsd,
  mapXaiPollStatus,
  normalizeXaiVideoDuration,
  normalizeXaiVideoResolution,
  parseXaiPollResponse,
  parseXaiSubmitResponse,
  xaiVideoGenerationsUrl,
  xaiVideoStatusUrl,
  XAI_VIDEO_API_BASE_URL,
  XAI_VIDEO_LITE_MODEL,
  type ImageToVideoSubmitInput,
  type ImageToVideoSubmitResult,
  type RetrievedVideo,
  type TextToVideoSubmitInput,
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
export class XaiVideoProvider extends BaseProvider implements VideoGenerationProvider {
  readonly name = 'xai';
  private readonly logger = new Logger(XaiVideoProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  shouldUseMock(forceMock?: boolean): boolean {
    if (forceMock) return true;
    return (
      this.config.get<string>('integrations.xaiVideoUseMock') === 'true' ||
      process.env.XAI_VIDEO_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  getModel(): string {
    return assertXaiLiteModel(
      this.config.get<string>('integrations.xaiVideoModel', XAI_VIDEO_LITE_MODEL),
    );
  }

  getBaseUrl(): string {
    return (
      this.config.get<string>('integrations.xaiVideoApiBaseUrl') ||
      process.env.XAI_VIDEO_API_BASE_URL ||
      XAI_VIDEO_API_BASE_URL
    ).replace(/\/$/, '');
  }

  estimateCost(durationSeconds: number, resolution: string): number {
    return estimateXaiVideoCostUsd(durationSeconds, resolution, {
      pricePerSecond480PUsd: Number.parseFloat(
        this.config.get<string>('integrations.xaiVideoPricePerSecond480PUsd', '0.02'),
      ),
      pricePerSecond720PUsd: Number.parseFloat(
        this.config.get<string>('integrations.xaiVideoPricePerSecond720PUsd', '0.03'),
      ),
      pricePerSecond1080PUsd: Number.parseFloat(
        this.config.get<string>('integrations.xaiVideoPricePerSecond1080PUsd', '0.14'),
      ),
      currency: this.config.get<string>('integrations.xaiVideoCurrency', 'USD'),
    });
  }

  supportsTextToVideo(): boolean {
    return true;
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('integrations.xaiApiKey') ||
      process.env.XAI_API_KEY ||
      undefined
    );
  }

  private getCurrency(): string {
    return this.config.get<string>('integrations.xaiVideoCurrency', 'USD');
  }

  private getTimeoutMs(): number {
    return this.config.get<number>('integrations.xaiVideoTimeoutMs', 120000);
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
      message.includes('econnreset')
    );
  }

  private mockSubmit(
    durationSeconds: number,
    resolution: string,
    model: string,
  ): ImageToVideoSubmitResult {
    const providerTaskId = `mock-xai-${randomUUID()}`;
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
      requestId: providerTaskId,
      estimatedCostUsd: this.estimateCost(durationSeconds, resolution),
      currency: this.getCurrency(),
      model: `mock:${model}`,
      mock: true,
    };
  }

  async submitTextToVideo(input: TextToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
    const model = assertXaiLiteModel(input.model ?? this.getModel());
    const durationSeconds = normalizeXaiVideoDuration(input.durationSeconds);
    const resolution = normalizeXaiVideoResolution(input.resolution);
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const currency = this.getCurrency();

    if (this.shouldUseMock()) {
      return this.mockSubmit(durationSeconds, resolution, model);
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'XAI_API_KEY');

    const body = buildXaiTextToVideoRequest({
      prompt: input.prompt,
      durationSeconds,
      resolution,
      aspectRatio: input.aspectRatio,
      model,
      user: input.externalTaskId,
    });

    try {
      const response = await axios.post(xaiVideoGenerationsUrl(this.getBaseUrl()), body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.getTimeoutMs(),
      });
      const parsed = parseXaiSubmitResponse(response.data);
      return {
        providerTaskId: parsed.request_id,
        status: 'submitted',
        requestId: parsed.request_id,
        estimatedCostUsd,
        currency,
        model,
      };
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: { message?: string }; message?: string }>;
      const message =
        axiosError.response?.data?.error?.message ||
        axiosError.response?.data?.message ||
        (error as Error).message ||
        'xAI text-to-video submit failed';
      this.logger.error(`xAI T2V submit failed: ${message}`);
      throw new Error(message);
    }
  }

  async submitImageToVideo(input: ImageToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
    const model = assertXaiLiteModel(input.model ?? this.getModel());
    const durationSeconds = normalizeXaiVideoDuration(input.durationSeconds);
    const resolution = normalizeXaiVideoResolution(input.resolution);
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const currency = this.getCurrency();

    if (this.shouldUseMock()) {
      return this.mockSubmit(durationSeconds, resolution, model);
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'XAI_API_KEY');

    const imageUrl = input.imageBase64
      ? input.imageBase64.startsWith('data:')
        ? input.imageBase64
        : `data:${input.imageMimeType || 'image/png'};base64,${input.imageBase64}`
      : input.imageUrl;

    const body = buildXaiImageToVideoRequest({
      prompt: input.motionPrompt,
      imageUrl,
      durationSeconds,
      resolution,
      aspectRatio: input.aspectRatio,
      model,
      user: input.externalTaskId,
    });

    try {
      const response = await axios.post(xaiVideoGenerationsUrl(this.getBaseUrl()), body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.getTimeoutMs(),
      });
      const parsed = parseXaiSubmitResponse(response.data);
      return {
        providerTaskId: parsed.request_id,
        status: 'submitted',
        requestId: parsed.request_id,
        estimatedCostUsd,
        currency,
        model,
      };
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: { message?: string }; message?: string }>;
      const message =
        axiosError.response?.data?.error?.message ||
        axiosError.response?.data?.message ||
        (error as Error).message ||
        'xAI image-to-video submit failed';
      this.logger.error(`xAI I2V submit failed: ${message}`);
      throw new Error(message);
    }
  }

  async getTaskStatus(providerTaskId: string): Promise<VideoProviderTaskStatusResult> {
    if (providerTaskId.startsWith('mock-xai-') || this.shouldUseMock()) {
      const existing = mockTaskStore.get(providerTaskId);
      if (!existing) {
        return {
          providerTaskId,
          status: 'failed',
          message: 'Unknown mock xAI task',
          outputs: [],
          mock: true,
        };
      }
      const readyAfter = this.config.get<number>('integrations.xaiVideoMockReadyAfterMs', 1500);
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
                  url: `mock://xai/${providerTaskId}.mp4`,
                  duration: String(existing.durationSeconds),
                },
              ]
            : [],
        actualCostUsd: this.estimateCost(existing.durationSeconds, existing.resolution),
        currency: this.getCurrency(),
        mock: true,
      };
    }

    const apiKey = this.getApiKey();
    this.assertConfigured(apiKey, 'XAI_API_KEY');

    try {
      const response = await axios.get(xaiVideoStatusUrl(providerTaskId, this.getBaseUrl()), {
        headers: { Authorization: `Bearer ${apiKey}` },
        // Status checks should not use the long submit timeout; keep room for slow xAI.
        timeout: Math.min(60_000, Math.max(15_000, this.getTimeoutMs())),
      });
      const parsed = parseXaiPollResponse(response.data);
      const status = mapXaiPollStatus(parsed.status);
      const videoUrl = parsed.video?.url ?? parsed.video?.file_output?.public_url ?? undefined;
      const actualCostUsd = costUsdFromXaiTicks(parsed.usage?.cost_in_usd_ticks);

      if (status === 'failed') {
        return {
          providerTaskId,
          status: 'failed',
          message: parsed.error?.message || 'xAI video generation failed',
          outputs: [],
          actualCostUsd,
          currency: this.getCurrency(),
          raw: parsed,
        };
      }

      return {
        providerTaskId,
        status,
        message:
          status === 'processing' || status === 'submitted'
            ? `progress=${parsed.progress ?? 0}`
            : undefined,
        outputs:
          status === 'succeeded' && videoUrl
            ? [
                {
                  type: 'video',
                  url: videoUrl,
                  duration: parsed.video?.duration,
                },
              ]
            : [],
        actualCostUsd,
        currency: this.getCurrency(),
        raw: parsed,
      };
    } catch (error) {
      if (this.isTransient(error)) {
        // Keep the poll loop alive — Grok jobs often take minutes; one slow status
        // response must not mark the clip FAILED.
        this.logger.warn(`Transient xAI status error: ${(error as Error).message}`);
        return {
          providerTaskId,
          status: 'processing',
          message: `transient:${(error as Error).message}`.slice(0, 500),
          outputs: [],
          currency: this.getCurrency(),
        };
      }
      throw error;
    }
  }

  async retrieveCompletedVideo(result: VideoProviderTaskStatusResult): Promise<RetrievedVideo> {
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
      throw new Error('No completed xAI video URL available');
    }

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: this.getTimeoutMs(),
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
