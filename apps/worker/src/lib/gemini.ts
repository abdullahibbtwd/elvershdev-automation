import { GoogleGenAI } from '@google/genai';
import {
  buildMotionAnalysisPrompt,
  buildScenePlanningPrompt,
  buildStoryGenerationPrompt,
  buildVisualAnalysisPrompt,
  createMockMotionAnalysis,
  createMockScenePlan,
  createMockStoryResult,
  createMockVisualAnalysis,
  estimateGeminiCostUsd,
  generatedScenePlanSchema,
  generatedStorySchema,
  getGeminiPricingFromEnv,
  motionAnalysisBatchSchema,
  visualAnalysisBatchSchema,
  type GeneratedScenePlan,
  type GeneratedStory,
  type MotionAnalysisBatch,
  type MotionAnalysisInput,
  type StoryBriefInput,
  type VisualAnalysisBatch,
  type VisualAnalysisCharacterInput,
  type VisualAnalysisSceneInput,
  type VisualStyleConfiguration,
} from '@ai-video/shared';
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

function shouldUseMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.GEMINI_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !process.env.GEMINI_API_KEY
  );
}

function getModel(): string {
  return process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
}

function getTimeoutMs(): number {
  return parseInt(process.env.GEMINI_TIMEOUT_MS ?? '60000', 10);
}

function getMaxRetries(): number {
  return parseInt(process.env.GEMINI_MAX_RETRIES ?? '3', 10);
}

async function generateJson<T>(
  _requestType: string,
  prompt: string,
  schema: ParseableSchema<T>,
): Promise<GeminiJsonResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = getModel();
  const timeoutMs = getTimeoutMs();
  const maxRetries = getMaxRetries();
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

      const data = schema.parse(parsed);
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

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

      if (attempt >= maxRetries || !transient) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateStoryContent(
  brief: StoryBriefInput,
  options?: { forceMock?: boolean },
): Promise<GeminiJsonResult<GeneratedStory>> {
  if (shouldUseMock(options?.forceMock)) {
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

  return generateJson('story_generation', buildStoryGenerationPrompt(brief), generatedStorySchema);
}

export async function planScenes(
  input: { brief: StoryBriefInput; story: GeneratedStory },
  options?: { forceMock?: boolean },
): Promise<GeminiJsonResult<GeneratedScenePlan>> {
  if (shouldUseMock(options?.forceMock)) {
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

  const result = await generateJson(
    'scene_planning',
    buildScenePlanningPrompt(input),
    generatedScenePlanSchema,
  );

  const total = result.data.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const delta = Math.abs(total - input.brief.desiredDurationSeconds) / input.brief.desiredDurationSeconds;
  if (delta > 0.15) {
    throw new Error(
      `Scene plan duration ${total}s differs from target ${input.brief.desiredDurationSeconds}s by more than 15%`,
    );
  }

  return result;
}

export interface AnalyzeVisualsInput {
  title: string;
  story: string;
  scenes: VisualAnalysisSceneInput[];
  characters: VisualAnalysisCharacterInput[];
  style: { name: string; configuration: VisualStyleConfiguration };
  aspectRatio: string;
}

export async function analyzeVisuals(
  input: AnalyzeVisualsInput,
  options?: { forceMock?: boolean },
): Promise<GeminiJsonResult<VisualAnalysisBatch>> {
  if (shouldUseMock(options?.forceMock)) {
    const data = createMockVisualAnalysis({
      scenes: input.scenes,
      characters: input.characters,
      style: input.style,
      aspectRatio: input.aspectRatio,
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

  return generateJson(
    'visual_analysis',
    buildVisualAnalysisPrompt(input),
    visualAnalysisBatchSchema,
  );
}

export async function analyzeMotion(
  input: MotionAnalysisInput,
  options?: { forceMock?: boolean },
): Promise<GeminiJsonResult<MotionAnalysisBatch>> {
  if (shouldUseMock(options?.forceMock)) {
    const data = createMockMotionAnalysis(input);
    return {
      data,
      rawText: JSON.stringify(data),
      usage: {
        model: 'mock-gemini',
        inputTokens: 220,
        outputTokens: 650,
        estimatedCostUsd: estimateGeminiCostUsd(220, 650, getGeminiPricingFromEnv()),
      },
    };
  }

  return generateJson(
    'motion_analysis',
    buildMotionAnalysisPrompt(input),
    motionAnalysisBatchSchema,
  );
}
