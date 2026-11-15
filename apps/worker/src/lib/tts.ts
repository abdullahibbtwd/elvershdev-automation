import { GoogleGenAI } from '@google/genai';
import {
  createMockWavBuffer,
  DEFAULT_GEMINI_TTS_VOICE,
  estimateAudioOutputTokens,
  estimateGeminiTtsCostFromTokens,
  estimateGeminiTtsCostUsd,
  estimateSpeakingDurationSeconds,
  estimateTextInputTokens,
  getGeminiTtsPricingFromEnv,
  GEMINI_PREBUILT_VOICES,
  isGeminiPrebuiltVoice,
  isWavBuffer,
  pcmToWav,
  type SpeechGenerationProvider,
  type SpeechGenerationRequest,
  type SpeechGenerationResult,
  type SpeechProviderVoice,
} from '@ai-video/shared';

function shouldUseMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.GEMINI_TTS_USE_MOCK === 'true' ||
    process.env.GEMINI_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !process.env.GEMINI_API_KEY
  );
}

function getTtsModel(): string {
  return process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-lite-tts';
}

function getTimeoutMs(): number {
  return parseInt(process.env.GEMINI_TTS_TIMEOUT_MS ?? '120000', 10);
}

function getMaxRetries(): number {
  return parseInt(process.env.GEMINI_TTS_MAX_RETRIES ?? '3', 10);
}

function parseSampleRateFromMime(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  if (match) {
    const rate = Number.parseInt(match[1], 10);
    if (Number.isFinite(rate) && rate > 0) return rate;
  }
  return 24_000;
}

function extractAudioFromInteraction(interaction: unknown): {
  dataBase64: string;
  mimeType: string;
} {
  const record = interaction as {
    output_audio?: { data?: string; mime_type?: string; mimeType?: string };
    outputAudio?: { data?: string; mimeType?: string; mime_type?: string };
    outputs?: Array<{ type?: string; data?: string; mime_type?: string; mimeType?: string }>;
    steps?: Array<{
      content?: Array<{ type?: string; data?: string; mime_type?: string; mimeType?: string }>;
    }>;
  };

  const direct = record.output_audio ?? record.outputAudio;
  if (direct?.data) {
    return {
      dataBase64: direct.data,
      mimeType: direct.mime_type ?? direct.mimeType ?? 'audio/wav',
    };
  }

  for (const output of record.outputs ?? []) {
    if (output?.data && (output.type === 'audio' || output.mime_type?.startsWith('audio'))) {
      return {
        dataBase64: output.data,
        mimeType: output.mime_type ?? output.mimeType ?? 'audio/wav',
      };
    }
  }

  for (const step of record.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part?.data && (part.type === 'audio' || part.mime_type?.startsWith('audio'))) {
        return {
          dataBase64: part.data,
          mimeType: part.mime_type ?? part.mimeType ?? 'audio/wav',
        };
      }
    }
  }

  throw new Error('Gemini TTS interaction returned no audio data');
}

/**
 * Normalize provider audio bytes to a playable WAV container.
 * Unary Gemini 3.8 TTS returns audio/wav with RIFF header by default.
 * Older generateContent paths may return headerless PCM (audio/L16).
 */
export function normalizeTtsAudioBytes(
  raw: Uint8Array,
  mimeType: string,
): { bytes: Uint8Array; mimeType: string; format: string; sampleRate: number; channels: number } {
  const lower = mimeType.toLowerCase();
  if (lower.includes('wav') || isWavBuffer(raw)) {
    return {
      bytes: raw,
      mimeType: 'audio/wav',
      format: 'wav',
      sampleRate: parseSampleRateFromMime(mimeType) || 24_000,
      channels: 1,
    };
  }

  if (lower.includes('l16') || lower.includes('pcm')) {
    const sampleRate = parseSampleRateFromMime(mimeType) || 24_000;
    const wav = pcmToWav(raw, sampleRate, 1, 16);
    return {
      bytes: wav,
      mimeType: 'audio/wav',
      format: 'wav',
      sampleRate,
      channels: 1,
    };
  }

  // If unrecognized but looks like WAV, accept it.
  if (isWavBuffer(raw)) {
    return {
      bytes: raw,
      mimeType: 'audio/wav',
      format: 'wav',
      sampleRate: 24_000,
      channels: 1,
    };
  }

  throw new Error(
    `Unsupported TTS audio mime type "${mimeType}". Expected audio/wav or audio/l16 PCM.`,
  );
}

export class GeminiSpeechGenerationProvider implements SpeechGenerationProvider {
  readonly providerId = 'gemini';

  constructor(private readonly forceMock?: boolean) {}

  validateConfiguration(): { ok: boolean; message?: string } {
    if (shouldUseMock(this.forceMock)) {
      return { ok: true, message: 'Using mock Gemini TTS' };
    }
    if (!process.env.GEMINI_API_KEY) {
      return { ok: false, message: 'GEMINI_API_KEY is not configured' };
    }
    return { ok: true };
  }

  estimateCost(text: string, estimatedDurationSeconds?: number): number {
    const duration =
      estimatedDurationSeconds ?? estimateSpeakingDurationSeconds(text);
    return estimateGeminiTtsCostUsd(text, duration, getGeminiTtsPricingFromEnv());
  }

  async listVoices(): Promise<SpeechProviderVoice[]> {
    // Official prebuilt studio catalog only — no fabricated preview audio.
    return GEMINI_PREBUILT_VOICES.map((voice) => ({
      ...voice,
      languageCodes: ['en'],
    }));
  }

  async generateSpeech(request: SpeechGenerationRequest): Promise<SpeechGenerationResult> {
    const voiceId = request.voiceId || process.env.GEMINI_TTS_DEFAULT_VOICE || DEFAULT_GEMINI_TTS_VOICE;
    if (!isGeminiPrebuiltVoice(voiceId)) {
      throw new Error(`Unsupported Gemini prebuilt voice: ${voiceId}`);
    }

    const maxChars = parseInt(process.env.GEMINI_TTS_MAX_CHARACTERS ?? '8000', 10);
    if (request.text.length > maxChars) {
      throw new Error(`Narration text exceeds GEMINI_TTS_MAX_CHARACTERS (${maxChars})`);
    }

    if (shouldUseMock(this.forceMock)) {
      const durationSeconds = estimateSpeakingDurationSeconds(request.text);
      const audioBytes = createMockWavBuffer({
        text: request.text,
        durationSeconds: Math.min(durationSeconds, 4),
        voiceId,
      });
      const estimatedCostUsd = estimateGeminiTtsCostUsd(
        request.text,
        durationSeconds,
        getGeminiTtsPricingFromEnv(),
      );
      return {
        audioBytes,
        mimeType: 'audio/wav',
        format: 'wav',
        sampleRate: 24_000,
        channels: 1,
        durationSeconds: Math.min(durationSeconds, 4),
        provider: this.providerId,
        model: 'mock-gemini-tts',
        voiceId,
        inputTokens: estimateTextInputTokens(request.text),
        outputTokens: estimateAudioOutputTokens(Math.min(durationSeconds, 4)),
        estimatedCostUsd,
        mocked: true,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const model = getTtsModel();
    const timeoutMs = getTimeoutMs();
    const maxRetries = getMaxRetries();
    const pricing = getGeminiTtsPricingFromEnv();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: 'v1beta' },
    });

    const style = request.speakingStyle?.trim();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Official Gemini 3.8 TTS Interactions API:
        // https://aistudio.google.com/docs/speech-generation
        const interactionPromise = ai.interactions.create({
          model,
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'text',
                  text: request.text,
                  ...(style
                    ? {
                        annotations: [
                          {
                            type: 'speech_metadata',
                            style,
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          ],
          response_format: {
            type: 'audio',
            mime_type: 'audio/wav',
            sample_rate: 24_000,
          },
          generation_config: {
            speech_config: [{ voice: voiceId }],
          },
        } as never);

        const interaction = await Promise.race([
          interactionPromise,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`Gemini TTS timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);

        const { dataBase64, mimeType } = extractAudioFromInteraction(interaction);
        const raw = Buffer.from(dataBase64, 'base64');
        if (raw.length === 0) {
          throw new Error('Gemini TTS returned empty audio payload');
        }

        const normalized = normalizeTtsAudioBytes(raw, mimeType);
        const approxDuration =
          (normalized.bytes.length - (isWavBuffer(normalized.bytes) ? 44 : 0)) /
          (normalized.sampleRate * normalized.channels * 2);
        const inputTokens = estimateTextInputTokens(request.text);
        const outputTokens = estimateAudioOutputTokens(approxDuration, pricing);
        const estimatedCostUsd = estimateGeminiTtsCostFromTokens(
          inputTokens,
          outputTokens,
          pricing,
        );

        return {
          audioBytes: normalized.bytes,
          mimeType: normalized.mimeType,
          format: normalized.format,
          sampleRate: normalized.sampleRate,
          channels: normalized.channels,
          durationSeconds: Number(approxDuration.toFixed(3)),
          provider: this.providerId,
          model,
          voiceId,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
          mocked: false,
        };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message.toLowerCase() : String(error);
        const transient =
          message.includes('timeout') ||
          message.includes('429') ||
          message.includes('rate') ||
          message.includes('unavailable') ||
          message.includes('503') ||
          message.includes('500') ||
          message.includes('fetch failed');

        if (attempt >= maxRetries || !transient) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function createSpeechGenerationProvider(forceMock?: boolean): SpeechGenerationProvider {
  return new GeminiSpeechGenerationProvider(forceMock);
}
