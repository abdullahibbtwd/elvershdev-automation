import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from './google-genai';
import {
  buildCaptionSuggestionPrompt,
  buildNarrationPlanningPrompt,
  buildScenePlanningPrompt,
  buildStoryGenerationPrompt,
  buildVisualAnalysisPrompt,
  captionSuggestionResultSchema,
  createMockCaptionSuggestion,
  createMockNarrationPlan,
  createMockScenePlan,
  createMockStoryResult,
  createMockVisualAnalysis,
  estimateGeminiCostUsd,
  captionSuggestionResultJsonSchema,
  generatedScenePlanJsonSchema,
  generatedScenePlanSchema,
  generatedStoryJsonSchema,
  generatedStorySchema,
  getGeminiPricingFromEnv,
  normalizeCaptionSuggestionResultInput,
  normalizeGeneratedScenePlanInput,
  normalizeGeneratedStoryInput,
  normalizePlannedNarrationScriptInput,
  normalizeVisualAnalysisBatchInput,
  plannedNarrationScriptJsonSchema,
  plannedNarrationScriptSchema,
  visualAnalysisBatchJsonSchema,
  visualAnalysisBatchSchema,
  type CaptionSuggestionInput,
  type CaptionSuggestionResult,
  type GeneratedScenePlan,
  type GeneratedStory,
  type NarrationPlanningInput,
  type PlannedNarrationScript,
  type StoryBriefInput,
  type VisualAnalysisBatch,
  type VisualAnalysisCharacterInput,
  type VisualAnalysisSceneInput,
  type VisualStyleConfiguration,
} from '@ai-video/shared';
import { BaseProvider } from './base.provider';

export interface GeminiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface GeminiJsonResult<T> {
  data: T;
  usage: GeminiUsage;
  rawText: string;
}

type ParseableSchema<T> = { parse: (input: unknown) => T };

@Injectable()
export class GeminiProvider extends BaseProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('integrations.geminiApiKey'));
  }

  shouldUseMock(): boolean {
    return (
      this.config.get<string>('integrations.geminiUseMock') === 'true' ||
      process.env.GEMINI_USE_MOCK === 'true' ||
      process.env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  getModel(): string {
    return this.config.get<string>('integrations.geminiModel', 'gemini-3.8-flash');
  }

  async generateStoryContent(brief: StoryBriefInput): Promise<GeminiJsonResult<GeneratedStory>> {
    if (this.shouldUseMock()) {
      const data = createMockStoryResult(brief);
      return {
        data,
        rawText: JSON.stringify(data),
        usage: {
          model: 'mock-gemini',
          inputTokens: 120,
          outputTokens: 400,
          estimatedCostUsd: estimateGeminiCostUsd(120, 400, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildStoryGenerationPrompt(brief);
    return this.generateJson('story_generation', prompt, generatedStorySchema, {
      responseJsonSchema: generatedStoryJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeGeneratedStoryInput,
    });
  }

  async planScenes(input: {
    brief: StoryBriefInput;
    story: GeneratedStory;
  }): Promise<GeminiJsonResult<GeneratedScenePlan>> {
    if (this.shouldUseMock()) {
      const data = createMockScenePlan(input.brief, input.story);
      return {
        data,
        rawText: JSON.stringify(data),
        usage: {
          model: 'mock-gemini',
          inputTokens: 200,
          outputTokens: 700,
          estimatedCostUsd: estimateGeminiCostUsd(200, 700, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildScenePlanningPrompt(input);
    const result = await this.generateJson('scene_planning', prompt, generatedScenePlanSchema, {
      responseJsonSchema: generatedScenePlanJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeGeneratedScenePlanInput,
    });
    this.assertDurationApprox(result.data, input.brief.desiredDurationSeconds);
    return result;
  }

  async analyzeVisuals(input: {
    title: string;
    story: string;
    scenes: VisualAnalysisSceneInput[];
    characters: VisualAnalysisCharacterInput[];
    style: { name: string; configuration: VisualStyleConfiguration };
    aspectRatio?: string;
  }): Promise<GeminiJsonResult<VisualAnalysisBatch>> {
    const aspectRatio = input.aspectRatio ?? '9:16';
    if (this.shouldUseMock()) {
      const data = createMockVisualAnalysis({
        scenes: input.scenes,
        characters: input.characters,
        style: input.style,
        aspectRatio,
      });
      return {
        data,
        rawText: JSON.stringify(data),
        usage: {
          model: 'mock-gemini',
          inputTokens: 250,
          outputTokens: 800,
          estimatedCostUsd: estimateGeminiCostUsd(250, 800, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildVisualAnalysisPrompt({
      ...input,
      aspectRatio,
    });
    return this.generateJson('visual_analysis', prompt, visualAnalysisBatchSchema, {
      responseJsonSchema: visualAnalysisBatchJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeVisualAnalysisBatchInput,
    });
  }

  /** @deprecated kept for compatibility */
  async generateStory(prompt: string): Promise<{ scenes: unknown[] }> {
    this.logger.warn(`Legacy generateStory called with prompt length ${prompt.length}`);
    return { scenes: [] };
  }

  /**
   * Plan per-scene spoken narration (text only) from approved story/scene narration.
   * Used by the API for synchronous/mock paths; the worker's narration-planning processor
   * performs the persisted, queued planning in production.
   */
  async planNarration(
    input: NarrationPlanningInput,
  ): Promise<GeminiJsonResult<PlannedNarrationScript>> {
    if (this.shouldUseMock()) {
      const data = createMockNarrationPlan(input);
      return {
        data,
        rawText: JSON.stringify(data),
        usage: {
          model: 'mock-gemini',
          inputTokens: 200,
          outputTokens: 500,
          estimatedCostUsd: estimateGeminiCostUsd(200, 500, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildNarrationPlanningPrompt(input);
    return this.generateJson('narration_planning', prompt, plannedNarrationScriptSchema, {
      responseJsonSchema: plannedNarrationScriptJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizePlannedNarrationScriptInput,
    });
  }

  async suggestSocialCaption(
    input: CaptionSuggestionInput,
  ): Promise<GeminiJsonResult<CaptionSuggestionResult>> {
    if (this.shouldUseMock()) {
      const data = createMockCaptionSuggestion(input);
      return {
        data,
        rawText: JSON.stringify(data),
        usage: {
          model: 'mock-gemini',
          inputTokens: 80,
          outputTokens: 120,
          estimatedCostUsd: estimateGeminiCostUsd(80, 120, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildCaptionSuggestionPrompt(input);
    return this.generateJson('social_caption', prompt, captionSuggestionResultSchema, {
      responseJsonSchema: captionSuggestionResultJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeCaptionSuggestionResultInput,
    });
  }

  /**
   * @deprecated Speech synthesis is performed by the worker speech-generation processor
   * (see `SpeechGenerationProvider` in @ai-video/shared). The API only enqueues VOICE jobs via
   * NarrationService; this stub is kept for backwards compatibility and returns no audio.
   */
  async synthesizeSpeech(_text: string): Promise<{ audioUrl?: string }> {
    this.logger.warn(
      'GeminiProvider.synthesizeSpeech is a no-op in the API; TTS runs in the worker speech-generation processor',
    );
    return {};
  }

  async generateJson<T>(
    requestType: string,
    prompt: string,
    schema: ParseableSchema<T>,
    options?: {
      responseJsonSchema?: Record<string, unknown>;
      normalize?: (raw: unknown) => unknown;
    },
  ): Promise<GeminiJsonResult<T>> {
    const apiKey = this.assertConfigured(
      this.config.get<string>('integrations.geminiApiKey'),
      'GEMINI_API_KEY',
    );
    const model = this.getModel();
    const timeoutMs = this.config.get<number>('integrations.geminiTimeoutMs', 60_000);
    const maxRetries = this.config.get<number>('integrations.geminiMaxRetries', 3);
    const pricing = getGeminiPricingFromEnv();
    const ai = new GoogleGenAI({ apiKey });

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.7,
              ...(options?.responseJsonSchema
                ? { responseJsonSchema: options.responseJsonSchema }
                : {}),
            },
          }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`Gemini request timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);

        const rawText = response.text ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          throw new Error('Gemini returned invalid JSON');
        }

        const normalized = options?.normalize ? options.normalize(parsed) : parsed;
        const data = schema.parse(normalized);
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

        this.logger.log(
          `Gemini ${requestType} ok model=${model} in=${inputTokens} out=${outputTokens}`,
        );

        return {
          data,
          rawText,
          usage: {
            model,
            inputTokens,
            outputTokens,
            estimatedCostUsd: estimateGeminiCostUsd(inputTokens, outputTokens, pricing),
          },
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

        this.logger.warn(
          `Gemini ${requestType} attempt ${attempt}/${maxRetries} failed: ${(error as Error).message}`,
        );

        if (attempt >= maxRetries || !transient) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private assertDurationApprox(plan: GeneratedScenePlan, targetSeconds: number) {
    const total = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    const delta = Math.abs(total - targetSeconds) / targetSeconds;
    if (delta > 0.15) {
      throw new Error(
        `Scene plan duration ${total}s differs from target ${targetSeconds}s by more than 15%`,
      );
    }
  }
}
