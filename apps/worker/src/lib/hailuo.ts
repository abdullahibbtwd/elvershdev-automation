import { fal } from '@fal-ai/client';
import axios, { type AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import {
  buildHailuoImageToVideoRequest,
  createMockMp4Buffer,
  estimateHailuoVideoCostUsd,
  getHailuoModelCapabilities,
  getHailuoPricingFromEnv,
  mapFalQueueStatusToVideoStatus,
  type ImageToVideoSubmitInput,
  type ImageToVideoSubmitResult,
  type RetrievedVideo,
  type VideoGenerationProvider,
  type VideoProviderTaskStatus,
  type VideoProviderTaskStatusResult,
} from '@ai-video/shared';

const mockTaskStore = new Map<
  string,
  {
    status: VideoProviderTaskStatus;
    createdAt: number;
    motionPrompt: string;
    durationSeconds: number;
    resolution: string;
    model: string;
  }
>();

export function getFalApiKey(): string | undefined {
  return process.env.FAL_API_KEY || process.env.FAL_KEY || undefined;
}

export function shouldUseHailuoMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.HAILUO_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !getFalApiKey()
  );
}

export function getHailuoModel(): string {
  return (
    process.env.HAILUO_MODEL ?? 'fal-ai/minimax/hailuo-02/standard/image-to-video'
  );
}

function getTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.HAILUO_TIMEOUT_MS ?? '600000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
}

function getMaxRetries(): number {
  const parsed = Number.parseInt(process.env.HAILUO_MAX_RETRIES ?? '2', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return Math.min(parsed, 5);
}

function getMockReadyAfterMs(): number {
  const parsed = Number.parseInt(process.env.HAILUO_MOCK_READY_AFTER_MS ?? '1500', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
}

function getPromptOptimizerDefault(): boolean {
  return process.env.HAILUO_PROMPT_OPTIMIZER !== 'false';
}

function configureFalClient(apiKey: string): void {
  fal.config({ credentials: apiKey });
}

function isTransientHailuoError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase?.() ?? '';
  const status = (error as AxiosError)?.response?.status;
  const falStatus = (error as { status?: number })?.status;
  const code = status ?? falStatus;
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    message.includes('timeout') ||
    message.includes('rate') ||
    message.includes('unavailable') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed')
  );
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = getMaxRetries();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isTransientHailuoError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function resolveHailuoImageUrl(input: ImageToVideoSubmitInput): Promise<string> {
  if (isHttpUrl(input.imageUrl)) {
    return input.imageUrl;
  }

  const apiKey = getFalApiKey();
  if (!apiKey) {
    throw new Error('FAL_API_KEY is required to upload source images for Hailuo');
  }
  configureFalClient(apiKey);

  let bytes: Uint8Array | undefined = input.imageBytes;
  let mimeType = input.imageMimeType || 'image/png';

  if (!bytes && input.imageBase64) {
    const raw = input.imageBase64.startsWith('data:')
      ? input.imageBase64.slice(input.imageBase64.indexOf(',') + 1)
      : input.imageBase64;
    bytes = Buffer.from(raw, 'base64');
    const match = /^data:([^;]+);/i.exec(input.imageBase64);
    if (match?.[1]) mimeType = match[1];
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error(
      'Hailuo requires a publicly reachable image_url, or image bytes/base64 for fal.storage upload',
    );
  }

  const file = new File([bytes], `hailuo-source-${randomUUID()}.png`, { type: mimeType });
  const uploadedUrl = await withRetries(() => fal.storage.upload(file));
  if (!uploadedUrl || !isHttpUrl(uploadedUrl)) {
    throw new Error('fal.storage.upload did not return a usable HTTP URL for Hailuo');
  }
  return uploadedUrl;
}

export class HailuoVideoProvider implements VideoGenerationProvider {
  readonly name = 'hailuo';

  isConfigured(): boolean {
    return Boolean(getFalApiKey());
  }

  shouldUseMock(forceMock?: boolean): boolean {
    return shouldUseHailuoMock(forceMock);
  }

  getModel(): string {
    return getHailuoModel();
  }

  estimateCost(durationSeconds: number, resolution: string): number {
    return estimateHailuoVideoCostUsd(
      durationSeconds,
      resolution,
      getHailuoPricingFromEnv(),
    );
  }

  async submitImageToVideo(input: ImageToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
    const model = input.model ?? this.getModel();
    const capabilities = getHailuoModelCapabilities(model, process.env);
    const durationSeconds =
      Number(input.durationSeconds) || capabilities.defaultDuration;
    const resolution = String(input.resolution || capabilities.defaultResolution);
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const pricing = getHailuoPricingFromEnv();

    if (this.shouldUseMock()) {
      // Validate request shape even in mock mode (use placeholder HTTP URL when local).
      const mockImageUrl = isHttpUrl(input.imageUrl)
        ? input.imageUrl
        : 'https://example.com/mock-hailuo-source.png';
      const validated = buildHailuoImageToVideoRequest({
        prompt: input.motionPrompt,
        imageUrl: mockImageUrl,
        durationSeconds,
        resolution,
        promptOptimizer: input.promptOptimizer ?? getPromptOptimizerDefault(),
        endImageUrl: input.lastFrameUrl,
        model,
        env: process.env,
      });

      const providerTaskId = `mock-hailuo-${randomUUID()}`;
      mockTaskStore.set(providerTaskId, {
        status: 'submitted',
        createdAt: Date.now(),
        motionPrompt: validated.body.prompt,
        durationSeconds: validated.durationSeconds,
        resolution: validated.resolution,
        model: `mock:${validated.model}`,
      });

      return {
        providerTaskId,
        status: 'submitted',
        externalTaskId: input.externalTaskId,
        requestId: providerTaskId,
        estimatedCostUsd,
        currency: pricing.currency,
        model: `mock:${validated.model}`,
        mock: true,
      };
    }

    const apiKey = getFalApiKey();
    if (!apiKey) {
      throw new Error('FAL_API_KEY is not configured');
    }
    configureFalClient(apiKey);

    const imageUrl = await resolveHailuoImageUrl(input);
    const validated = buildHailuoImageToVideoRequest({
      prompt: input.motionPrompt,
      imageUrl,
      durationSeconds,
      resolution,
      promptOptimizer: input.promptOptimizer ?? getPromptOptimizerDefault(),
      endImageUrl: input.lastFrameUrl,
      model,
      env: process.env,
    });

    const submitted = await withRetries(() =>
      fal.queue.submit(validated.endpointId, {
        input: validated.body,
      }),
    );

    const requestId = (submitted as { request_id?: string }).request_id;
    if (!requestId) {
      throw new Error('Hailuo submit response missing request_id');
    }

    return {
      providerTaskId: requestId,
      status: 'submitted',
      externalTaskId: input.externalTaskId,
      requestId,
      estimatedCostUsd,
      currency: pricing.currency,
      model: validated.model,
    };
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

      const readyAfter = getMockReadyAfterMs();
      const elapsed = Date.now() - existing.createdAt;
      let status: VideoProviderTaskStatus = 'submitted';
      if (elapsed >= readyAfter) {
        status = 'succeeded';
      } else if (elapsed >= readyAfter / 2) {
        status = 'processing';
      }
      existing.status = status;
      mockTaskStore.set(providerTaskId, existing);

      return {
        providerTaskId,
        status,
        outputs:
          status === 'succeeded'
            ? [
                {
                  type: 'video',
                  id: providerTaskId,
                  url: `mock://hailuo/${providerTaskId}.mp4`,
                  duration: String(existing.durationSeconds),
                },
              ]
            : [],
        actualCostUsd: this.estimateCost(existing.durationSeconds, existing.resolution),
        currency: getHailuoPricingFromEnv().currency,
        mock: true,
      };
    }

    const apiKey = getFalApiKey();
    if (!apiKey) {
      throw new Error('FAL_API_KEY is not configured');
    }
    configureFalClient(apiKey);

    const endpointId = getHailuoModel();
    const statusResponse = await withRetries(() =>
      fal.queue.status(endpointId, {
        requestId: providerTaskId,
        logs: false,
      }),
    );

    const mapped = mapFalQueueStatusToVideoStatus(
      (statusResponse as { status?: string }).status,
    );

    if (mapped === 'succeeded') {
      const result = await withRetries(() =>
        fal.queue.result(endpointId, { requestId: providerTaskId }),
      );
      const data = (result as { data?: { video?: { url?: string } } }).data;
      const videoUrl = data?.video?.url;
      if (!videoUrl) {
        throw new Error('Hailuo completed without a video URL');
      }

      const capabilities = getHailuoModelCapabilities(endpointId, process.env);
      return {
        providerTaskId,
        status: 'succeeded',
        outputs: [
          {
            type: 'video',
            url: videoUrl,
            duration: String(capabilities.defaultDuration),
          },
        ],
        // fal queue result does not return billed cash amounts; keep estimate as actual for accounting.
        actualCostUsd: undefined,
        currency: getHailuoPricingFromEnv().currency,
        raw: undefined,
      };
    }

    if (mapped === 'failed') {
      const message =
        (statusResponse as { error?: string }).error ||
        (statusResponse as { message?: string }).message ||
        'Hailuo generation failed';
      return {
        providerTaskId,
        status: 'failed',
        message: String(message),
        outputs: [],
      };
    }

    return {
      providerTaskId,
      status: mapped,
      outputs: [],
    };
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

    let host: string | undefined;
    try {
      host = new URL(url).host;
    } catch {
      host = undefined;
    }

    const response = await withRetries(() =>
      axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: Math.min(getTimeoutMs(), 180_000),
        maxContentLength: 250 * 1024 * 1024,
        maxBodyLength: 250 * 1024 * 1024,
        headers: {
          Accept: 'video/*,application/octet-stream,*/*',
        },
      }),
    );

    const buffer = Buffer.from(response.data);
    if (buffer.length < 32) {
      throw new Error('Downloaded Hailuo video is empty or truncated');
    }

    const mimeType =
      (response.headers['content-type'] as string | undefined)?.split(';')[0]?.trim() ||
      'video/mp4';

    return {
      buffer,
      mimeType,
      contentLength: buffer.length,
      sourceUrlHost: host,
    };
  }

  async cancelTask(_providerTaskId: string): Promise<boolean> {
    // fal queue cancel is not relied upon; local cancellation is handled by MotionGeneration status.
    return false;
  }
}

export const hailuoVideoProvider = new HailuoVideoProvider();

export async function submitHailuoImageToVideo(
  input: ImageToVideoSubmitInput,
  options?: { forceMock?: boolean; provider?: VideoGenerationProvider },
): Promise<ImageToVideoSubmitResult> {
  const provider = options?.provider ?? hailuoVideoProvider;
  if (options?.forceMock) {
    const previous = process.env.HAILUO_USE_MOCK;
    process.env.HAILUO_USE_MOCK = 'true';
    try {
      return await provider.submitImageToVideo(input);
    } finally {
      if (previous === undefined) delete process.env.HAILUO_USE_MOCK;
      else process.env.HAILUO_USE_MOCK = previous;
    }
  }
  return provider.submitImageToVideo(input);
}

export async function getHailuoTaskStatus(
  providerTaskId: string,
  options?: { provider?: VideoGenerationProvider },
): Promise<VideoProviderTaskStatusResult> {
  const provider = options?.provider ?? hailuoVideoProvider;
  return provider.getTaskStatus(providerTaskId);
}

export async function retrieveCompletedHailuoVideo(
  result: VideoProviderTaskStatusResult,
  options?: { provider?: VideoGenerationProvider },
): Promise<RetrievedVideo> {
  const provider = options?.provider ?? hailuoVideoProvider;
  return provider.retrieveCompletedVideo(result);
}

/** Test helper to clear in-memory mock tasks between unit tests. */
export function clearHailuoMockTasks(): void {
  mockTaskStore.clear();
}
