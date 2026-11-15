export interface KlingModelCapabilities {
  modelId: string;
  submitPath: string;
  supportedDurations: number[];
  supportedResolutions: Array<'720p' | '1080p'>;
  supportsNegativePrompt: boolean;
  supportsLastFrame: boolean;
  supportsNativeAudio: boolean;
  supportsReferenceImages: boolean;
  maxPromptChars: number;
  imageFormats: string[];
  maxImageBytes: number;
  minImageEdgePx: number;
  aspectRatioMin: number;
  aspectRatioMax: number;
  cancelSupported: boolean;
}

const KLING_2_6: KlingModelCapabilities = {
  modelId: 'kling-2.6',
  submitPath: '/image-to-video/kling-2.6',
  supportedDurations: [5, 10],
  supportedResolutions: ['720p', '1080p'],
  supportsNegativePrompt: false,
  supportsLastFrame: true,
  supportsNativeAudio: true,
  supportsReferenceImages: false,
  maxPromptChars: 2500,
  imageFormats: ['.jpg', '.jpeg', '.png'],
  maxImageBytes: 50 * 1024 * 1024,
  minImageEdgePx: 300,
  aspectRatioMin: 1 / 2.5,
  aspectRatioMax: 2.5,
  cancelSupported: false,
};

const KLING_2_5_TURBO: KlingModelCapabilities = {
  ...KLING_2_6,
  modelId: 'kling-2.5-turbo',
  submitPath: '/image-to-video/kling-2.5-turbo',
  supportsNativeAudio: false,
};

const KLING_3_0: KlingModelCapabilities = {
  ...KLING_2_6,
  modelId: 'kling-3.0',
  submitPath: '/image-to-video/kling-3.0',
};

const MODEL_MAP: Record<string, KlingModelCapabilities> = {
  'kling-2.6': KLING_2_6,
  'kling-2.5-turbo': KLING_2_5_TURBO,
  'kling-3.0': KLING_3_0,
};

export function getKlingModelCapabilities(
  model?: string,
  env: Record<string, string | undefined> = {},
): KlingModelCapabilities {
  const selected = (model || env.KLING_MODEL || 'kling-2.6').trim();
  const base = MODEL_MAP[selected] ?? {
    ...KLING_2_6,
    modelId: selected,
    submitPath: `/image-to-video/${selected}`,
  };

  return {
    ...base,
    supportsNegativePrompt:
      env.KLING_SUPPORTS_NEGATIVE_PROMPT === 'true'
        ? true
        : env.KLING_SUPPORTS_NEGATIVE_PROMPT === 'false'
          ? false
          : base.supportsNegativePrompt,
    supportsLastFrame:
      env.KLING_SUPPORTS_LAST_FRAME === 'true'
        ? true
        : env.KLING_SUPPORTS_LAST_FRAME === 'false'
          ? false
          : base.supportsLastFrame,
  };
}

export function getKlingSubmitPath(model?: string): string {
  return getKlingModelCapabilities(model).submitPath;
}

export type HailuoResolution = '512P' | '768P';
export type HailuoDuration = 6 | 10;

export interface HailuoModelCapabilities {
  modelId: string;
  endpointId: string;
  supportedDurations: HailuoDuration[];
  supportedResolutions: HailuoResolution[];
  supportsPromptOptimizer: boolean;
  supportsEndImage: boolean;
  /** end_image_url is only accepted at 768P on the Standard endpoint */
  endImageRequiresResolution: HailuoResolution;
  supportsNegativePrompt: boolean;
  maxPromptChars: number;
  imageFormats: string[];
  maxImageBytes: number;
  minImageEdgePx: number;
  aspectRatioMin: number;
  aspectRatioMax: number;
  cancelSupported: boolean;
  defaultDuration: HailuoDuration;
  defaultResolution: HailuoResolution;
  defaultPromptOptimizer: boolean;
}

const HAILUO_02_STANDARD: HailuoModelCapabilities = {
  modelId: 'fal-ai/minimax/hailuo-02/standard/image-to-video',
  endpointId: 'fal-ai/minimax/hailuo-02/standard/image-to-video',
  supportedDurations: [6, 10],
  supportedResolutions: ['512P', '768P'],
  supportsPromptOptimizer: true,
  supportsEndImage: true,
  endImageRequiresResolution: '768P',
  supportsNegativePrompt: false,
  maxPromptChars: 2500,
  imageFormats: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'],
  maxImageBytes: 20 * 1024 * 1024,
  minImageEdgePx: 300,
  aspectRatioMin: 2 / 5,
  aspectRatioMax: 5 / 2,
  cancelSupported: false,
  defaultDuration: 6,
  defaultResolution: '768P',
  defaultPromptOptimizer: true,
};

export function getHailuoModelCapabilities(
  model?: string,
  env: Record<string, string | undefined> = {},
): HailuoModelCapabilities {
  const selected = (
    model ||
    env.HAILUO_MODEL ||
    'fal-ai/minimax/hailuo-02/standard/image-to-video'
  ).trim();

  const defaultResolutionRaw = (env.HAILUO_DEFAULT_RESOLUTION ?? '768P').toUpperCase();
  const defaultResolution: HailuoResolution =
    defaultResolutionRaw === '512P' ? '512P' : '768P';
  const defaultDurationRaw = Number.parseInt(env.HAILUO_DEFAULT_DURATION ?? '6', 10);
  const defaultDuration: HailuoDuration = defaultDurationRaw === 10 ? 10 : 6;
  const defaultPromptOptimizer = env.HAILUO_PROMPT_OPTIMIZER !== 'false';

  return {
    ...HAILUO_02_STANDARD,
    modelId: selected,
    endpointId: selected,
    defaultDuration,
    defaultResolution,
    defaultPromptOptimizer,
  };
}

export function normalizeHailuoResolution(resolution: string | undefined): HailuoResolution {
  const normalized = String(resolution || '768P').toUpperCase();
  return normalized === '512P' ? '512P' : '768P';
}

export function normalizeHailuoDuration(duration: number | string | undefined): HailuoDuration {
  const value = typeof duration === 'string' ? Number.parseInt(duration, 10) : Number(duration);
  return value === 10 ? 10 : 6;
}
