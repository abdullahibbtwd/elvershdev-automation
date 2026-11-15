/**
 * Gemini TTS estimated pricing helpers.
 * Official rates (Developer API, through Dec 31 2026):
 * - gemini-3.8-flash-lite-tts: $0.50 / 1M text input tokens, $6.00 / 1M audio output tokens
 * - gemini-3.8-flash-tts: $0.50 / 1M text input tokens, $9.00 / 1M audio output tokens
 * Audio tokens = 25 tokens per second of audio.
 * Source: https://aistudio.google.com/docs/pricing
 *
 * These helpers produce ESTIMATES only — not live provider billing.
 */

export interface GeminiTtsPricingConfig {
  model: string;
  priceInputPerMillionUsd: number;
  priceAudioOutputPerMillionUsd: number;
  audioTokensPerSecond: number;
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

const MODEL_DEFAULTS: Record<string, { input: number; audioOut: number }> = {
  'gemini-3.8-flash-lite-tts': { input: 0.5, audioOut: 6.0 },
  'gemini-3.8-flash-tts': { input: 0.5, audioOut: 9.0 },
};

export function getGeminiTtsPricingFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): GeminiTtsPricingConfig {
  const model = env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-lite-tts';
  const defaults = MODEL_DEFAULTS[model] ?? MODEL_DEFAULTS['gemini-3.8-flash-lite-tts'];
  const priceInputPerMillionUsd = Number.parseFloat(
    env.GEMINI_TTS_PRICE_INPUT_PER_MILLION_USD ?? String(defaults.input),
  );
  const priceAudioOutputPerMillionUsd = Number.parseFloat(
    env.GEMINI_TTS_PRICE_AUDIO_OUTPUT_PER_MILLION_USD ?? String(defaults.audioOut),
  );
  const audioTokensPerSecond = Number.parseFloat(env.GEMINI_TTS_AUDIO_TOKENS_PER_SECOND ?? '25');

  return {
    model,
    priceInputPerMillionUsd: Number.isFinite(priceInputPerMillionUsd)
      ? priceInputPerMillionUsd
      : defaults.input,
    priceAudioOutputPerMillionUsd: Number.isFinite(priceAudioOutputPerMillionUsd)
      ? priceAudioOutputPerMillionUsd
      : defaults.audioOut,
    audioTokensPerSecond: Number.isFinite(audioTokensPerSecond) ? audioTokensPerSecond : 25,
    currency: env.GEMINI_TTS_CURRENCY ?? 'USD',
  };
}

/** Rough input-token estimate when provider usage metadata is unavailable (~4 chars/token). */
export function estimateTextInputTokens(text: string): number {
  const chars = text.length;
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateAudioOutputTokens(
  durationSeconds: number,
  pricing: GeminiTtsPricingConfig = getGeminiTtsPricingFromEnv(),
): number {
  return Math.max(0, Math.ceil(Math.max(0, durationSeconds) * pricing.audioTokensPerSecond));
}

/**
 * Estimated USD cost from text length and expected/actual audio duration.
 * Label as estimate — not provider invoice amount.
 */
export function estimateGeminiTtsCostUsd(
  text: string,
  durationSeconds: number,
  pricing: GeminiTtsPricingConfig = getGeminiTtsPricingFromEnv(),
): number {
  const inputTokens = estimateTextInputTokens(text);
  const audioTokens = estimateAudioOutputTokens(durationSeconds, pricing);
  const inputCost = (inputTokens / 1_000_000) * pricing.priceInputPerMillionUsd;
  const outputCost = (audioTokens / 1_000_000) * pricing.priceAudioOutputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

export function estimateGeminiTtsCostFromTokens(
  inputTokens: number,
  audioOutputTokens: number,
  pricing: GeminiTtsPricingConfig = getGeminiTtsPricingFromEnv(),
): number {
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * pricing.priceInputPerMillionUsd;
  const outputCost =
    (Math.max(0, audioOutputTokens) / 1_000_000) * pricing.priceAudioOutputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

/** Words-per-minute heuristic for planning estimated speaking duration. */
export function estimateSpeakingDurationSeconds(text: string, wordsPerMinute = 150): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = words / Math.max(1, wordsPerMinute);
  return Number(Math.max(0.5, minutes * 60).toFixed(2));
}
