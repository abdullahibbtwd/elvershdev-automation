/**
 * Configurable Gemini pricing (USD per 1M tokens).
 * Do not invent live provider prices in code paths — override via env.
 */
export interface GeminiPricingConfig {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

function readProcessEnv(): Record<string, string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function getGeminiPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): GeminiPricingConfig {
  return {
    inputPerMillionUsd: parseFloat(env.GEMINI_PRICE_INPUT_PER_MILLION_USD ?? '0.10'),
    outputPerMillionUsd: parseFloat(env.GEMINI_PRICE_OUTPUT_PER_MILLION_USD ?? '0.40'),
  };
}

export function estimateGeminiCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: GeminiPricingConfig,
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}
