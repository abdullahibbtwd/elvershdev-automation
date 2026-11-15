export interface KlingPricingConfig {
  pricePerSecondUsd: number;
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
