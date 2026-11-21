export interface KlingPricingConfig {
  pricePerSecondUsd: number;
  currency: string;
}

export interface HailuoPricingConfig {
  pricePerSecond768PUsd: number;
  pricePerSecond512PUsd: number;
  currency: string;
}

function readProcessEnv(): Record<string, string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function getKlingPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): KlingPricingConfig {
  const raw = env.KLING_PRICE_PER_SECOND_USD ?? '0.07';
  const pricePerSecondUsd = Number.parseFloat(raw);
  return {
    pricePerSecondUsd: Number.isFinite(pricePerSecondUsd) ? pricePerSecondUsd : 0.07,
    currency: env.KLING_CURRENCY ?? 'USD',
  };
}

/**
 * Estimated cost only — configurable env pricing, not an official live Kling price sheet.
 * Resolution multipliers are optional config knobs for budget planning.
 */
export function estimateKlingVideoCostUsd(
  durationSeconds: number,
  resolution: string = '720p',
  pricing: KlingPricingConfig = getKlingPricingFromEnv(),
): number {
  const duration = Math.max(0, durationSeconds);
  const resolutionMultiplier =
    resolution === '1080p'
      ? Number.parseFloat(readProcessEnv().KLING_PRICE_1080P_MULTIPLIER ?? '1.25') || 1.25
      : 1;
  return Number((duration * pricing.pricePerSecondUsd * resolutionMultiplier).toFixed(6));
}

export function getHailuoPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): HailuoPricingConfig {
  const raw768 = env.HAILUO_PRICE_PER_SECOND_768P_USD ?? '0.045';
  const raw512 = env.HAILUO_PRICE_PER_SECOND_512P_USD ?? '0.017';
  const price768 = Number.parseFloat(raw768);
  const price512 = Number.parseFloat(raw512);
  return {
    pricePerSecond768PUsd: Number.isFinite(price768) ? price768 : 0.045,
    pricePerSecond512PUsd: Number.isFinite(price512) ? price512 : 0.017,
    currency: env.HAILUO_CURRENCY ?? env.FAL_IMAGE_CURRENCY ?? 'USD',
  };
}

/**
 * Estimated Hailuo-02 Standard cost — configurable env pricing aligned with fal.ai published rates.
 * 768P default: $0.045/sec → 6s ≈ $0.27. 512P: ~$0.017/sec when that resolution is available.
 */
export function estimateHailuoVideoCostUsd(
  durationSeconds: number,
  resolution: string = '768P',
  pricing: HailuoPricingConfig = getHailuoPricingFromEnv(),
): number {
  const duration = Math.max(0, durationSeconds);
  const normalized = String(resolution || '768P').toUpperCase();
  const perSecond =
    normalized === '512P' ? pricing.pricePerSecond512PUsd : pricing.pricePerSecond768PUsd;
  return Number((duration * perSecond).toFixed(6));
}

export interface XaiVideoPricingConfig {
  pricePerSecond480PUsd: number;
  pricePerSecond720PUsd: number;
  pricePerSecond1080PUsd: number;
  currency: string;
}

export function getXaiVideoPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): XaiVideoPricingConfig {
  const parse = (raw: string | undefined, fallback: number) => {
    const value = Number.parseFloat(raw ?? String(fallback));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    // Official docs.x.ai pricing for grok-imagine-video-1.5-lite
    pricePerSecond480PUsd: parse(env.XAI_VIDEO_PRICE_PER_SECOND_480P_USD, 0.02),
    pricePerSecond720PUsd: parse(env.XAI_VIDEO_PRICE_PER_SECOND_720P_USD, 0.03),
    pricePerSecond1080PUsd: parse(env.XAI_VIDEO_PRICE_PER_SECOND_1080P_USD, 0.14),
    currency: env.XAI_VIDEO_CURRENCY ?? 'USD',
  };
}

/**
 * Estimated xAI Grok Imagine Video 1.5 Lite cost — official published per-second rates by resolution.
 * 720p default: $0.03/sec.
 */
export function estimateXaiVideoCostUsd(
  durationSeconds: number,
  resolution: string = '720p',
  pricing: XaiVideoPricingConfig = getXaiVideoPricingFromEnv(),
): number {
  const duration = Math.max(0, durationSeconds);
  const normalized = String(resolution || '720p').trim().toLowerCase();
  const perSecond =
    normalized === '480p' || normalized === '480'
      ? pricing.pricePerSecond480PUsd
      : normalized === '1080p' || normalized === '1080'
        ? pricing.pricePerSecond1080PUsd
        : pricing.pricePerSecond720PUsd;
  return Number((duration * perSecond).toFixed(6));
}

export function estimateVideoGenerationCostUsd(
  provider: string,
  durationSeconds: number,
  resolution: string,
  env: Record<string, string | undefined> = readProcessEnv(),
): number {
  const normalized = (provider || '').toLowerCase();
  if (normalized === 'hailuo') {
    return estimateHailuoVideoCostUsd(durationSeconds, resolution, getHailuoPricingFromEnv(env));
  }
  if (normalized === 'xai' || normalized === 'grok') {
    return estimateXaiVideoCostUsd(durationSeconds, resolution, getXaiVideoPricingFromEnv(env));
  }
  return estimateKlingVideoCostUsd(durationSeconds, resolution, getKlingPricingFromEnv(env));
}
