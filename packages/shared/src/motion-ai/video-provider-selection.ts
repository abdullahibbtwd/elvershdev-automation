export const VIDEO_PROVIDER_IDS = ['hailuo', 'kling', 'xai'] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDER_IDS)[number];

export interface VideoProviderAvailability {
  id: VideoProviderId;
  displayName: string;
  default: boolean;
  enabled: boolean;
  available: boolean;
  configured: boolean;
  mockMode: boolean;
  model: string;
  defaultDurationSeconds: number;
  defaultResolution: string;
  supportedDurations: number[];
  supportedResolutions: string[];
  estimatedCostPerDefaultClipUsd: number;
  currency: string;
  unavailableReason?: string;
}

function readProcessEnv(): Record<string, string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function normalizeVideoProviderId(
  value: string | undefined | null,
  env: Record<string, string | undefined> = readProcessEnv(),
): VideoProviderId {
  const raw = (value || env.VIDEO_GENERATION_PROVIDER || 'hailuo').trim().toLowerCase();
  if (raw === 'kling') return 'kling';
  if (raw === 'xai' || raw === 'grok') return 'xai';
  return 'hailuo';
}

export function getDefaultVideoProviderId(
  env: Record<string, string | undefined> = readProcessEnv(),
): VideoProviderId {
  return normalizeVideoProviderId(env.VIDEO_GENERATION_PROVIDER, env);
}

/** Kling remains registered for future use; disabled unless explicitly enabled. */
export function isKlingVideoProviderEnabled(
  env: Record<string, string | undefined> = readProcessEnv(),
): boolean {
  return env.KLING_ENABLED === 'true';
}

export function isHailuoVideoProviderEnabled(
  env: Record<string, string | undefined> = readProcessEnv(),
): boolean {
  return env.HAILUO_ENABLED !== 'false';
}

/** xAI Grok Lite is opt-in; disabled unless explicitly enabled. */
export function isXaiVideoProviderEnabled(
  env: Record<string, string | undefined> = readProcessEnv(),
): boolean {
  return env.XAI_VIDEO_ENABLED === 'true';
}

export function assertVideoProviderSelectable(
  provider: VideoProviderId,
  env: Record<string, string | undefined> = readProcessEnv(),
): void {
  if (provider === 'kling' && !isKlingVideoProviderEnabled(env)) {
    throw new Error(
      'Kling video generation is currently disabled (set KLING_ENABLED=true to use it). Hailuo is the default provider.',
    );
  }
  if (provider === 'hailuo' && !isHailuoVideoProviderEnabled(env)) {
    throw new Error('Hailuo video generation is disabled (HAILUO_ENABLED=false).');
  }
  if (provider === 'xai' && !isXaiVideoProviderEnabled(env)) {
    throw new Error(
      'xAI Grok video generation is disabled (set XAI_VIDEO_ENABLED=true to use it).',
    );
  }
}
