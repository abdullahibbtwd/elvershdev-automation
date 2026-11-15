import axios, { type AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import {
  createMockMp4Buffer,
  estimateKlingVideoCostUsd,
  getKlingModelCapabilities,
  getKlingPricingFromEnv,
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

export function shouldUseKlingMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.KLING_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !getKlingApiKey()
  );
}

export function getKlingApiKey(): string | undefined {
  return process.env.KLING_API_KEY || process.env.KLING_ACCESS_KEY || undefined;
}

export function getKlingBaseUrl(): string {
  return (process.env.KLING_API_BASE_URL ?? 'https://api-singapore.klingai.com').replace(
    /\/$/,
    '',
  );
}

export function getKlingModel(): string {
  return process.env.KLING_MODEL ?? 'kling-2.6';
}

function getTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.KLING_TIMEOUT_MS ?? '120000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function getMaxRetries(): number {
  const parsed = Number.parseInt(process.env.KLING_MAX_RETRIES ?? '3', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return Math.min(parsed, 5);
}

function getMockReadyAfterMs(): number {
  const parsed = Number.parseInt(process.env.KLING_MOCK_READY_AFTER_MS ?? '1500', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
}

function mapProviderStatus(status: string | undefined): VideoProviderTaskStatus {
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

function isTransientKlingError(error: unknown): boolean {
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
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed')
  );
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = getMaxRetries();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isTransientKlingError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function firstFrameValue(input: ImageToVideoSubmitInput): string {
  if (input.imageBase64?.trim()) {
    return input.imageBase64.startsWith('data:')
      ? input.imageBase64
      : `data:image/png;base64,${input.imageBase64}`;
  }
  return input.imageUrl;
}

export class KlingVideoProvider implements VideoGenerationProvider {
  readonly name = 'kling';

  isConfigured(): boolean {
    return Boolean(getKlingApiKey());
  }

  shouldUseMock(forceMock?: boolean): boolean {
    return shouldUseKlingMock(forceMock);
  }

  getModel(): string {
    return getKlingModel();
  }

  estimateCost(durationSeconds: number, resolution: string): number {
    return estimateKlingVideoCostUsd(durationSeconds, resolution, getKlingPricingFromEnv());
  }

  async submitImageToVideo(input: ImageToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
    const model = input.model ?? this.getModel();
    const capabilities = getKlingModelCapabilities(model, process.env);
    const durationSeconds = Number(input.durationSeconds) || 5;
    const resolution = String(input.resolution || '720p');
    const estimatedCostUsd = this.estimateCost(durationSeconds, resolution);
    const pricing = getKlingPricingFromEnv();

    if (!capabilities.supportedDurations.includes(durationSeconds)) {
      throw new Error(
        `Kling model ${model} does not support duration ${durationSeconds}s. Supported: ${capabilities.supportedDurations.join(', ')}`,
      );
    }
    if (!capabilities.supportedResolutions.includes(resolution as '720p' | '1080p')) {
      throw new Error(
        `Kling model ${model} does not support resolution ${resolution}. Supported: ${capabilities.supportedResolutions.join(', ')}`,
      );
    }

    if (this.shouldUseMock()) {
      const providerTaskId = `mock-kling-${randomUUID()}`;
      mockTaskStore.set(providerTaskId, {
        status: 'submitted',
        createdAt: Date.now(),
        motionPrompt: input.motionPrompt,
        durationSeconds,
        resolution,
        model: `mock:${model}`,
      });
      return {
        providerTaskId,
        status: 'submitted',
        externalTaskId: input.externalTaskId,
        estimatedCostUsd,
        currency: pricing.currency,
        model: `mock:${model}`,
        mock: true,
      };
    }

    const apiKey = getKlingApiKey();
    if (!apiKey) {
      throw new Error('KLING_API_KEY is not configured');
    }

    const contents: Array<Record<string, unknown>> = [
      {
        type: 'prompt',
        text: input.motionPrompt.slice(0, capabilities.maxPromptChars),
      },
      {
        type: 'first_frame',
        url: firstFrameValue(input),
      },
    ];

    if (input.lastFrameUrl && capabilities.supportsLastFrame) {
      contents.push({ type: 'last_frame', url: input.lastFrameUrl });
    }

    const body: Record<string, unknown> = {
      contents,
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

    const submitPath = capabilities.submitPath;
    const response = await withRetries(() =>
      axios.post(`${getKlingBaseUrl()}${submitPath}`, body, {
        headers: authHeaders(apiKey),
        timeout: Math.min(getTimeoutMs(), 60_000),
      }),
    );

    if (response.data?.code !== 0 && response.data?.code !== undefined) {
      throw new Error(
        `Kling submit failed: ${response.data?.message || `code ${response.data.code}`}`,
      );
    }

    const taskId = response.data?.data?.id as string | undefined;
    if (!taskId) {
      throw new Error('Kling submit response missing task id');
    }

    return {
      providerTaskId: taskId,
      status: mapProviderStatus(response.data?.data?.status),
      externalTaskId: response.data?.data?.external_id,
      requestId: response.data?.request_id,
      estimatedCostUsd,
      currency: pricing.currency,
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
                  url: `mock://kling/${providerTaskId}.mp4`,
                  duration: String(existing.durationSeconds),
                },
              ]
            : [],
        actualCostUsd: this.estimateCost(existing.durationSeconds, existing.resolution),
        currency: getKlingPricingFromEnv().currency,
        mock: true,
      };
    }

    const apiKey = getKlingApiKey();
    if (!apiKey) {
      throw new Error('KLING_API_KEY is not configured');
    }

    const response = await withRetries(() =>
      axios.get(`${getKlingBaseUrl()}/tasks`, {
        headers: authHeaders(apiKey),
        params: { task_ids: providerTaskId },
        timeout: Math.min(getTimeoutMs(), 30_000),
      }),
    );

    if (response.data?.code !== 0 && response.data?.code !== undefined) {
      throw new Error(
        `Kling status failed: ${response.data?.message || `code ${response.data.code}`}`,
      );
    }

    const task = Array.isArray(response.data?.data)
      ? response.data.data[0]
      : response.data?.data;
    if (!task) {
      throw new Error('Kling status response missing task');
    }

    const outputs = Array.isArray(task.outputs)
      ? task.outputs
          .filter((item: { type?: string; url?: string }) => item?.type === 'video' && item.url)
          .map((item: { type: string; id?: string; url: string; watermark_url?: string; duration?: string }) => ({
            type: 'video' as const,
            id: item.id,
            url: item.url,
            watermarkUrl: item.watermark_url,
            duration: item.duration,
          }))
      : [];

    let actualCostUsd: number | undefined;
    let currency: string | undefined;
    if (Array.isArray(task.billing) && task.billing.length > 0) {
      const cash = task.billing.find(
        (row: { charge_type?: string; amount?: string; currency?: string }) =>
          row.charge_type === 'cash',
      );
      if (cash?.amount) {
        const amount = Number.parseFloat(String(cash.amount));
        if (Number.isFinite(amount)) {
          actualCostUsd = amount;
          currency = cash.currency || 'USD';
        }
      }
    }

    return {
      providerTaskId: String(task.id ?? providerTaskId),
      status: mapProviderStatus(task.status),
      message: task.message,
      outputs,
      billing: task.billing,
      actualCostUsd,
      currency,
      raw: undefined,
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
      throw new Error('No completed Kling video URL available');
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
        timeout: getTimeoutMs(),
        maxContentLength: 250 * 1024 * 1024,
        maxBodyLength: 250 * 1024 * 1024,
        // Do not send API key to CDN hosts; Kling result URLs are signed/hotlink-protected.
        headers: {
          Accept: 'video/*,application/octet-stream,*/*',
        },
      }),
    );

    const buffer = Buffer.from(response.data);
    if (buffer.length < 32) {
      throw new Error('Downloaded Kling video is empty or truncated');
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
    // Official Kling image-to-video docs do not expose a cancel endpoint.
    return false;
  }
}

export const klingVideoProvider = new KlingVideoProvider();

export async function submitImageToVideo(
  input: ImageToVideoSubmitInput,
  options?: { forceMock?: boolean; provider?: VideoGenerationProvider },
): Promise<ImageToVideoSubmitResult> {
  const provider = options?.provider ?? klingVideoProvider;
  if (options?.forceMock) {
    const previous = process.env.KLING_USE_MOCK;
    process.env.KLING_USE_MOCK = 'true';
    try {
      return await provider.submitImageToVideo(input);
    } finally {
      if (previous === undefined) delete process.env.KLING_USE_MOCK;
      else process.env.KLING_USE_MOCK = previous;
    }
  }
  return provider.submitImageToVideo(input);
}

export async function getKlingTaskStatus(
  providerTaskId: string,
  options?: { forceMock?: boolean; provider?: VideoGenerationProvider },
): Promise<VideoProviderTaskStatusResult> {
  const provider = options?.provider ?? klingVideoProvider;
  if (options?.forceMock && !providerTaskId.startsWith('mock-kling-')) {
    // Status for non-mock ids under forceMock still goes through provider mock branch when configured.
  }
  return provider.getTaskStatus(providerTaskId);
}

export async function retrieveCompletedKlingVideo(
  result: VideoProviderTaskStatusResult,
  options?: { provider?: VideoGenerationProvider },
): Promise<RetrievedVideo> {
  const provider = options?.provider ?? klingVideoProvider;
  return provider.retrieveCompletedVideo(result);
}

/** Test helper to clear in-memory mock tasks between unit tests. */
export function clearKlingMockTasks(): void {
  mockTaskStore.clear();
}
