import axios, { type AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import {
  assertXaiLiteModel,
  buildXaiImageToVideoRequest,
  buildXaiTextToVideoRequest,
  costUsdFromXaiTicks,
  createMockMp4Buffer,
  estimateXaiVideoCostUsd,
  getXaiVideoPricingFromEnv,
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

export function shouldUseXaiVideoMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.XAI_VIDEO_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !getXaiApiKey()
  );
}

export function getXaiApiKey(): string | undefined {
  return process.env.XAI_API_KEY || undefined;
}

export function getXaiVideoBaseUrl(): string {
  return (process.env.XAI_VIDEO_API_BASE_URL ?? XAI_VIDEO_API_BASE_URL).replace(/\/$/, '');
}

export function getXaiVideoModel(): string {
  return assertXaiLiteModel(process.env.XAI_VIDEO_MODEL ?? XAI_VIDEO_LITE_MODEL);
}

function getTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.XAI_VIDEO_TIMEOUT_MS ?? '120000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function getMockReadyAfterMs(): number {
  const parsed = Number.parseInt(process.env.XAI_VIDEO_MOCK_READY_AFTER_MS ?? '1500', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
}

function getCurrency(): string {
  return process.env.XAI_VIDEO_CURRENCY ?? 'USD';
}

function estimateCost(durationSeconds: number, resolution: string): number {
  return estimateXaiVideoCostUsd(durationSeconds, resolution, getXaiVideoPricingFromEnv());
}

function isTransient(error: unknown): boolean {
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

function mockSubmit(
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
    estimatedCostUsd: estimateCost(durationSeconds, resolution),
    currency: getCurrency(),
    model: `mock:${model}`,
    mock: true,
  };
}

async function submitTextToVideo(input: TextToVideoSubmitInput): Promise<ImageToVideoSubmitResult> {
  const model = assertXaiLiteModel(input.model ?? getXaiVideoModel());
  const durationSeconds = normalizeXaiVideoDuration(input.durationSeconds);
  const resolution = normalizeXaiVideoResolution(input.resolution);
  const estimatedCostUsd = estimateCost(durationSeconds, resolution);

  if (shouldUseXaiVideoMock()) {
    return mockSubmit(durationSeconds, resolution, model);
  }

  const apiKey = getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not configured. Set the corresponding environment variable.');
  }

  const body = buildXaiTextToVideoRequest({
    prompt: input.prompt,
    durationSeconds,
    resolution,
    aspectRatio: input.aspectRatio,
    model,
    user: input.externalTaskId,
  });

  try {
    const response = await axios.post(xaiVideoGenerationsUrl(getXaiVideoBaseUrl()), body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: getTimeoutMs(),
    });
    const parsed = parseXaiSubmitResponse(response.data);
    return {
      providerTaskId: parsed.request_id,
      status: 'submitted',
      requestId: parsed.request_id,
      estimatedCostUsd,
      currency: getCurrency(),
      model,
    };
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: { message?: string }; message?: string }>;
    throw new Error(
      axiosError.response?.data?.error?.message ||
        axiosError.response?.data?.message ||
        (error as Error).message ||
        'xAI text-to-video submit failed',
    );
  }
}

async function submitImageToVideo(
  input: ImageToVideoSubmitInput,
): Promise<ImageToVideoSubmitResult> {
  const model = assertXaiLiteModel(input.model ?? getXaiVideoModel());
  const durationSeconds = normalizeXaiVideoDuration(input.durationSeconds);
  const resolution = normalizeXaiVideoResolution(input.resolution);
  const estimatedCostUsd = estimateCost(durationSeconds, resolution);

  if (shouldUseXaiVideoMock()) {
    return mockSubmit(durationSeconds, resolution, model);
  }

  const apiKey = getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not configured. Set the corresponding environment variable.');
  }

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
    model,
    user: input.externalTaskId,
  });

  try {
    const response = await axios.post(xaiVideoGenerationsUrl(getXaiVideoBaseUrl()), body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: getTimeoutMs(),
    });
    const parsed = parseXaiSubmitResponse(response.data);
    return {
      providerTaskId: parsed.request_id,
      status: 'submitted',
      requestId: parsed.request_id,
      estimatedCostUsd,
      currency: getCurrency(),
      model,
    };
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: { message?: string }; message?: string }>;
    throw new Error(
      axiosError.response?.data?.error?.message ||
        axiosError.response?.data?.message ||
        (error as Error).message ||
        'xAI image-to-video submit failed',
    );
  }
}

async function getTaskStatus(providerTaskId: string): Promise<VideoProviderTaskStatusResult> {
  if (providerTaskId.startsWith('mock-xai-') || shouldUseXaiVideoMock()) {
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
    const readyAfter = getMockReadyAfterMs();
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
      actualCostUsd: estimateCost(existing.durationSeconds, existing.resolution),
      currency: getCurrency(),
      mock: true,
    };
  }

  const apiKey = getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not configured. Set the corresponding environment variable.');
  }

  try {
    const response = await axios.get(xaiVideoStatusUrl(providerTaskId, getXaiVideoBaseUrl()), {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30_000,
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
        currency: getCurrency(),
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
          ? [{ type: 'video', url: videoUrl, duration: parsed.video?.duration }]
          : [],
      actualCostUsd,
      currency: getCurrency(),
      raw: parsed,
    };
  } catch (error) {
    if (isTransient(error)) {
      // Caller/poller may retry.
    }
    throw error;
  }
}

async function retrieveCompletedVideo(
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
    throw new Error('No completed xAI video URL available');
  }

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: getTimeoutMs(),
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

export const xaiVideoProvider: VideoGenerationProvider = {
  name: 'xai',
  isConfigured: () => Boolean(getXaiApiKey()),
  shouldUseMock: shouldUseXaiVideoMock,
  getModel: getXaiVideoModel,
  estimateCost,
  supportsTextToVideo: () => true,
  submitTextToVideo,
  submitImageToVideo,
  getTaskStatus,
  retrieveCompletedVideo,
  cancelTask: async () => false,
};
