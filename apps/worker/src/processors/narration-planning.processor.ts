import type { Job, Processor } from 'bullmq';
import {
  JobStatus,
  NarrationScriptStatus,
  Prisma,
  SceneNarrationStatus,
} from '@prisma/client';
import {
  buildNarrationPlanningPrompt,
  createMockNarrationPlan,
  estimateGeminiCostUsd,
  getGeminiPricingFromEnv,
  plannedNarrationScriptSchema,
  type GenerationQueuePayload,
  type NarrationPlanningInput,
  type PlannedNarrationScript,
} from '@ai-video/shared';
import { GoogleGenAI } from '../lib/google-genai';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';

function shouldUseMock(forceMock?: boolean): boolean {
  if (forceMock) return true;
  return (
    process.env.GEMINI_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    !process.env.GEMINI_API_KEY
  );
}

async function planNarrationWithGemini(
  input: NarrationPlanningInput,
  forceMock?: boolean,
): Promise<{
  data: PlannedNarrationScript;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}> {
  if (shouldUseMock(forceMock)) {
    const data = createMockNarrationPlan(input);
    return {
      data,
      usage: {
        model: 'mock-gemini',
        inputTokens: 180,
        outputTokens: 420,
        estimatedCostUsd: estimateGeminiCostUsd(180, 420, getGeminiPricingFromEnv()),
      },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS ?? '60000', 10);
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildNarrationPlanningPrompt(input);

  const response = await Promise.race([
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.5,
      },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Gemini narration planning timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

  const rawText = response.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini returned invalid JSON for narration planning');
  }

  const data = plannedNarrationScriptSchema.parse(parsed);
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    data,
    usage: {
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateGeminiCostUsd(inputTokens, outputTokens, getGeminiPricingFromEnv()),
    },
  };
}

export function createNarrationPlanningProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const storyId = data.storyId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const narrationScriptId =
      data.narrationScriptId ??
      (typeof payload.narrationScriptId === 'string' ? payload.narrationScriptId : undefined);

    logger.info(
      {
        bullJobId: job.id,
        generationJobId,
        storyId,
        narrationScriptId,
        attempt: job.attemptsMade + 1,
      },
      'Narration planning started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        return { status: 'cancelled' };
      }

      await prisma.generationJob.updateMany({
        where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
        data: {
          status: JobStatus.PROCESSING,
          progress: 10,
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    if (narrationScriptId) {
      await prisma.narrationScript.updateMany({
        where: { id: narrationScriptId },
        data: { status: NarrationScriptStatus.PLANNING, errorMessage: null },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in narration-planning');
      }
      if (!storyId) {
        throw new Error('storyId is required for narration planning');
      }
      if (!narrationScriptId) {
        throw new Error('narrationScriptId is required for narration planning');
      }

      const story = await prisma.story.findUnique({
        where: { id: storyId },
        include: {
          scenes: { orderBy: { sceneNumber: 'asc' } },
          characters: { orderBy: { name: 'asc' } },
        },
      });
      if (!story) {
        throw new Error(`Story ${storyId} not found`);
      }
      if (story.scenes.length === 0) {
        throw new Error('Story has no scenes to narrate');
      }

      await job.updateProgress(30);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: { progress: 30 },
        });
      }

      const planningInput: NarrationPlanningInput = {
        title: story.title,
        story: story.content,
        openingHook: story.openingHook,
        narrationScript: story.narrationScript,
        closingMessage: story.closingMessage,
        language: story.language,
        tone: story.tone,
        targetDurationSeconds: story.targetDurationSeconds,
        characters: story.characters.map((c) => ({ name: c.name })),
        scenes: story.scenes.map((scene) => ({
          sceneId: scene.id,
          sceneNumber: scene.sceneNumber,
          durationSeconds: scene.durationSeconds,
          narration: scene.narration,
          visualDescription: scene.visualDescription,
        })),
      };

      const result = await planNarrationWithGemini(planningInput, Boolean(data.useMockAi));

      // Map sceneNumber → sceneId from DB; prefer model sceneId when valid.
      const scenesByNumber = new Map(story.scenes.map((s) => [s.sceneNumber, s]));
      const scenesById = new Map(story.scenes.map((s) => [s.id, s]));

      const normalizedScenes = result.data.scenes.map((scene, index) => {
        const matched =
          (scene.sceneId && scenesById.get(scene.sceneId)) ||
          scenesByNumber.get(scene.sceneNumber);
        if (!matched) {
          throw new Error(
            `Narration plan scene ${scene.sceneNumber} does not match story scenes`,
          );
        }
        return {
          ...scene,
          sceneId: matched.id,
          sequence: scene.sequence || index + 1,
        };
      });

      await job.updateProgress(70);

      await prisma.$transaction(async (tx) => {
        await tx.sceneNarration.deleteMany({ where: { narrationScriptId } });
        await tx.sceneNarration.createMany({
          data: normalizedScenes.map((scene) => ({
            narrationScriptId,
            storyId,
            sceneId: scene.sceneId!,
            sequence: scene.sequence,
            text: scene.text,
            emotionalTone: scene.emotionalTone,
            speakingStyle: scene.speakingStyle,
            deliveryInstructions: scene.deliveryInstructions || null,
            pronunciationGuidance: scene.pronunciationGuidance || null,
            estimatedDuration: scene.estimatedDurationSeconds,
            status: SceneNarrationStatus.READY,
          })),
        });

        await tx.narrationScript.update({
          where: { id: narrationScriptId },
          data: {
            status: NarrationScriptStatus.READY,
            fullText: result.data.fullText,
            notes: result.data.notes || null,
            errorMessage: null,
          },
        });

        // Keep story-level narration script in sync for Phase 8 consumers.
        await tx.story.update({
          where: { id: storyId },
          data: { narrationScript: result.data.fullText },
        });
      });

      if (generationJobId) {
        await prisma.providerUsage.create({
          data: {
            userId: data.userId,
            storyId,
            generationJobId,
            provider: 'gemini',
            model: result.usage.model,
            requestType: 'narration_planning',
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            estimatedCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
            metadata: {
              narrationScriptId,
              sceneCount: normalizedScenes.length,
              mocked: shouldUseMock(Boolean(data.useMockAi)),
            },
          },
        });

        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            actualCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
            completedAt: new Date(),
            result: {
              narrationScriptId,
              sceneCount: normalizedScenes.length,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await job.updateProgress(100);
      logger.info(
        { generationJobId, narrationScriptId, scenes: normalizedScenes.length },
        'Narration planning completed',
      );

      return {
        status: 'completed',
        narrationScriptId,
        sceneCount: normalizedScenes.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, generationJobId, narrationScriptId }, 'Narration planning failed');

      if (narrationScriptId) {
        await prisma.narrationScript.updateMany({
          where: { id: narrationScriptId },
          data: {
            status: NarrationScriptStatus.FAILED,
            errorMessage: message,
          },
        });
      }

      const maxAttempts = job.opts.attempts ?? 3;
      const isFinal = job.attemptsMade + 1 >= maxAttempts;

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            status: isFinal ? JobStatus.FAILED : JobStatus.PROCESSING,
            errorMessage: message,
            ...(isFinal ? { completedAt: new Date() } : {}),
          },
        });
      }

      throw error;
    }
  };
}
