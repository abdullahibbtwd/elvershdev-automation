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
