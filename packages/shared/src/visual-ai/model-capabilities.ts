export interface FalModelCapabilities {
  modelId: string;
  supportsReferenceImages: boolean;
  supportsSeed: boolean;
  supportsCustomImageSize: boolean;
  supportsNegativePrompt: boolean;
  defaultImageSize:
    | 'square_hd'
    | 'square'
    | 'portrait_4_3'
    | 'portrait_16_9'
    | 'landscape_4_3'
    | 'landscape_16_9'
    | { width: number; height: number };
}

const KNOWN_MODELS: Record<string, FalModelCapabilities> = {
  'fal-ai/flux/dev': {
    modelId: 'fal-ai/flux/dev',
    supportsReferenceImages: false,
    supportsSeed: true,
    supportsCustomImageSize: true,
    supportsNegativePrompt: false,
    defaultImageSize: { width: 576, height: 1024 },
  },
  'fal-ai/flux/schnell': {
    modelId: 'fal-ai/flux/schnell',
    supportsReferenceImages: false,
    supportsSeed: true,
    supportsCustomImageSize: true,
    supportsNegativePrompt: false,
    defaultImageSize: { width: 576, height: 1024 },
  },
  'fal-ai/flux-pulid': {
    modelId: 'fal-ai/flux-pulid',
    supportsReferenceImages: true,
    supportsSeed: true,
    supportsCustomImageSize: true,
    supportsNegativePrompt: true,
    defaultImageSize: { width: 576, height: 1024 },
  },
  'fal-ai/ip-adapter-face-id': {
    modelId: 'fal-ai/ip-adapter-face-id',
    supportsReferenceImages: true,
    supportsSeed: true,
    supportsCustomImageSize: true,
    supportsNegativePrompt: true,
    defaultImageSize: { width: 576, height: 1024 },
  },
};

function readProcessEnv(): Record<string, string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function getFalModelCapabilities(
  modelId?: string | null,
  env: Record<string, string | undefined> = readProcessEnv(),
): FalModelCapabilities {
  const resolved = (modelId || env.FAL_IMAGE_MODEL || 'fal-ai/flux/dev').trim();
  const known = KNOWN_MODELS[resolved];
  if (known) {
    const override =
      env.FAL_IMAGE_SUPPORTS_REFERENCE === 'true'
        ? true
        : env.FAL_IMAGE_SUPPORTS_REFERENCE === 'false'
          ? false
          : known.supportsReferenceImages;
    return { ...known, supportsReferenceImages: override };
  }

  return {
    modelId: resolved,
    supportsReferenceImages: env.FAL_IMAGE_SUPPORTS_REFERENCE === 'true',
    supportsSeed: true,
    supportsCustomImageSize: true,
    supportsNegativePrompt: env.FAL_IMAGE_SUPPORTS_NEGATIVE_PROMPT === 'true',
    defaultImageSize: aspectRatioToImageSize(env.FAL_IMAGE_DEFAULT_ASPECT_RATIO ?? '9:16'),
  };
}

export function aspectRatioToImageSize(
  aspectRatio: string,
): FalModelCapabilities['defaultImageSize'] {
  switch (aspectRatio.trim()) {
    case '1:1':
      return 'square_hd';
    case '4:3':
      return 'landscape_4_3';
    case '16:9':
      return 'landscape_16_9';
    case '3:4':
      return 'portrait_4_3';
    case '9:16':
    default:
      return { width: 576, height: 1024 };
  }
}
