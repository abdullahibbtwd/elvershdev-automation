import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_GEMINI_TTS_VOICE,
  createMockWavBuffer,
  estimateAudioOutputTokens,
  estimateGeminiTtsCostFromTokens,
  estimateSpeakingDurationSeconds,
  estimateTextInputTokens,
  getGeminiTtsPricingFromEnv,
  isGeminiPrebuiltVoice,
  isWavBuffer,
  pcmToWav,
} from '@ai-video/shared';
import { GoogleGenAI } from './google-genai';
import { BaseProvider } from './base.provider';

export type GeminiTtsResult = {
  audioBytes: Uint8Array;
  mimeType: string;
  format: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  model: string;
  voiceId: string;
  estimatedCostUsd: number;
  mocked: boolean;
};

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

function normalizeTtsAudioBytes(
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
  if (isWavBuffer(raw)) {
    return {
      bytes: raw,
      mimeType: 'audio/wav',
      format: 'wav',
      sampleRate: 24_000,
      channels: 1,
    };
  }
  throw new Error(`Unsupported TTS audio mime type "${mimeType}"`);
}

@Injectable()
export class GeminiTtsProvider extends BaseProvider {
  private readonly logger = new Logger(GeminiTtsProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  shouldUseMock(forceMock?: boolean): boolean {
    if (forceMock) return true;
    if (this.config.get<string>('integrations.geminiTtsUseMock') === 'true') return true;
    if (process.env.GEMINI_TTS_USE_MOCK === 'true') return true;
    if (process.env.NODE_ENV === 'test') return true;
    return !process.env.GEMINI_API_KEY;
  }

  async generateSpeech(input: {
    text: string;
    voiceId?: string;
    speakingStyle?: string;
    forceMock?: boolean;
  }): Promise<GeminiTtsResult> {
    const voiceId =
      input.voiceId ||
      process.env.GEMINI_TTS_DEFAULT_VOICE ||
      DEFAULT_GEMINI_TTS_VOICE;
    if (!isGeminiPrebuiltVoice(voiceId)) {
      throw new Error(`Unsupported Gemini prebuilt voice: ${voiceId}`);
    }

    if (this.shouldUseMock(input.forceMock)) {
      if (input.forceMock !== true && process.env.GEMINI_TTS_USE_MOCK !== 'true') {
        throw new Error(
          'Gemini TTS would use mock but real mode was requested. Set GEMINI_API_KEY and GEMINI_TTS_USE_MOCK=false.',
        );
      }
      const durationSeconds = Math.min(estimateSpeakingDurationSeconds(input.text), 4);
      const audioBytes = createMockWavBuffer({
        text: input.text,
        durationSeconds,
        voiceId,
      });
      return {
        audioBytes,
        mimeType: 'audio/wav',
        format: 'wav',
        sampleRate: 24_000,
        channels: 1,
        durationSeconds,
        model: 'mock-gemini-tts',
        voiceId,
        estimatedCostUsd: 0,
        mocked: true,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    this.assertConfigured(apiKey, 'GEMINI_API_KEY');

    const model = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-lite-tts';
    const timeoutMs = Number.parseInt(process.env.GEMINI_TTS_TIMEOUT_MS ?? '120000', 10);
    const pricing = getGeminiTtsPricingFromEnv();
    const ai = new GoogleGenAI({
      apiKey: apiKey!,
      httpOptions: { apiVersion: 'v1beta' },
    });

    const style = input.speakingStyle?.trim();
    this.logger.log(`Gemini TTS REAL voice=${voiceId} chars=${input.text.length}`);

    const interactionPromise = ai.interactions.create({
      model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: input.text,
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
    if (raw.length === 0) throw new Error('Gemini TTS returned empty audio');
    const normalized = normalizeTtsAudioBytes(raw, mimeType);
    const approxDuration =
      (normalized.bytes.length - (isWavBuffer(normalized.bytes) ? 44 : 0)) /
      (normalized.sampleRate * normalized.channels * 2);
    const inputTokens = estimateTextInputTokens(input.text);
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
      model,
      voiceId,
      estimatedCostUsd,
      mocked: false,
    };
  }
}
