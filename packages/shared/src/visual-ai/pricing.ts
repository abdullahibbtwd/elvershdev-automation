export interface FalPricingConfig {
  pricePerImageUsd: number;
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

export function getFalPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): FalPricingConfig {
  const raw = env.FAL_IMAGE_PRICE_PER_IMAGE ?? '0.025';
  const pricePerImageUsd = Number.parseFloat(raw);
  return {
    pricePerImageUsd: Number.isFinite(pricePerImageUsd) ? pricePerImageUsd : 0.025,
    currency: env.FAL_IMAGE_CURRENCY ?? 'USD',
  };
}

export function estimateFalImageCostUsd(
  imageCount: number,
  pricing: FalPricingConfig = getFalPricingFromEnv(),
): number {
  const count = Math.max(0, imageCount);
  return Number((count * pricing.pricePerImageUsd).toFixed(6));
}
