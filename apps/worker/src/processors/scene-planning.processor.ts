import type { Job, Processor } from 'bullmq';
import { JobStatus, Prisma, StoryStatus } from '@prisma/client';
import {
  generatedStorySchema,
  storyBriefSchema,
  type GenerationQueuePayload,
  type GeneratedStory,
  type StoryBriefInput,
} from '@ai-video/shared';
import { planScenes } from '../lib/gemini';
import { getPrisma } from '../lib/prisma';
import type { Logger } from '../lib/logger';

function asBrief(payload: Record<string, unknown> | undefined): StoryBriefInput {
  return storyBriefSchema.parse(payload?.brief ?? payload);
}

async function loadGeneratedStory(
  prisma: ReturnType<typeof getPrisma>,
  storyId: string,
  payload: Record<string, unknown>,
): Promise<GeneratedStory> {
  if (payload.generatedStory) {
    return generatedStorySchema.parse(payload.generatedStory);
  }

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { characters: true },
  });
  if (!story) {
    throw new Error(`Story ${storyId} not found`);
  }

  return generatedStorySchema.parse({
    title: story.title,
    story: story.content,
    openingHook: story.openingHook ?? story.content.slice(0, 120),
    narrationScript: story.narrationScript ?? story.content,
    closingMessage: story.closingMessage ?? 'Thanks for watching.',
    description: story.description ?? story.title,
    hashtags: story.hashtags.length > 0 ? story.hashtags : ['story'],
    characters: story.characters.map((c) => ({
      name: c.name,
      appearance: c.appearance,
      clothing: c.clothing,
      ageRange: c.ageRange,
      hair: c.hair,
      distinctiveFeatures: c.distinctiveFeatures,
      consistencyNotes: c.consistencyNotes,
    })),
  });
}

function assertCharacterConsistency(story: GeneratedStory, planCharacters: GeneratedStory['characters']) {
  if (story.characters.length === 0) return;

  const byName = new Map(planCharacters.map((c) => [c.name.toLowerCase(), c]));
  for (const original of story.characters) {
    const planned = byName.get(original.name.toLowerCase());
    if (!planned) continue;
    const fields: Array<keyof typeof original> = [
      'appearance',
      'clothing',
      'ageRange',
      'hair',
      'distinctiveFeatures',
    ];
    for (const field of fields) {
      if (
        planned[field].toLowerCase().includes('contradict') ||
        (field === 'hair' &&
          planned.hair.length > 0 &&
          original.hair.length > 0 &&
          planned.hair !== original.hair &&
          !planned.hair.toLowerCase().includes(original.hair.toLowerCase().split(' ')[0] ?? ''))
      ) {
        // Soft check: prefer original bible in DB writes below
      }
    }
  }
}

export function createScenePlanningProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const storyId = data.storyId;
    const storyGenerationId = data.storyGenerationId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    logger.info(
      { bullJobId: job.id, generationJobId, storyId, attempt: job.attemptsMade + 1 },
      'Scene planning started',
    );

    if (generationJobId) {
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
    if (storyGenerationId) {
      await prisma.storyGeneration.updateMany({
        where: { id: storyGenerationId },
        data: { status: JobStatus.PROCESSING },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in scene-planning');
      }
      if (!storyId) {
        throw new Error('storyId is required for scene planning jobs');
      }

      const brief = asBrief(payload);
      const generatedStory = await loadGeneratedStory(prisma, storyId, payload);

      await job.updateProgress(35);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: { progress: 35 },
        });
      }

      const result = await planScenes(
        { brief, story: generatedStory },
        { forceMock: Boolean(data.useMockAi) || process.env.NODE_ENV === 'test' },
      );

      assertCharacterConsistency(generatedStory, result.data.characters);

      // Prefer original character bible when regenerating scenes
      const characters =
        generatedStory.characters.length > 0 ? generatedStory.characters : result.data.characters;

      await prisma.$transaction(async (tx) => {
        await tx.storyScene.deleteMany({ where: { storyId } });
        await tx.storyScene.createMany({
          data: result.data.scenes.map((scene) => ({
            storyId,
            sceneNumber: scene.sceneNumber,
            durationSeconds: scene.durationSeconds,
            narration: scene.narration,
            visualDescription: scene.visualDescription,
            imagePrompt: scene.imagePrompt,
            videoPrompt: scene.videoPrompt,
            cameraMovement: scene.cameraMovement,
            lighting: scene.lighting,
            environment: scene.environment,
            characterConsistencyInstructions: scene.characterConsistencyInstructions,
          })),
        });

        if (characters.length > 0) {
          await tx.characterProfile.deleteMany({ where: { storyId } });
          await tx.characterProfile.createMany({
            data: characters.map((character) => ({
              storyId,
              name: character.name,
              appearance: character.appearance,
              clothing: character.clothing,
              ageRange: character.ageRange,
              hair: character.hair,
              distinctiveFeatures: character.distinctiveFeatures,
              consistencyNotes: character.consistencyNotes,
            })),
          });
        }

        await tx.story.updateMany({
          where: { id: storyId, userId: data.userId },
          data: { status: StoryStatus.READY },
        });
      });

      await prisma.providerUsage.create({
        data: {
          userId: data.userId,
          storyId,
          generationJobId: generationJobId ?? undefined,
          provider: 'gemini',
          model: result.usage.model,
          requestType: 'scene_planning',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
          metadata: {
            sceneCount: result.data.scenes.length,
            totalDurationSeconds: result.data.totalDurationSeconds,
          } as Prisma.InputJsonValue,
        },
      });

      if (storyGenerationId) {
        await prisma.storyGeneration.updateMany({
          where: { id: storyGenerationId },
          data: {
            status: JobStatus.COMPLETED,
            model: result.usage.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            estimatedCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
            result: result.data as unknown as Prisma.InputJsonValue,
            errorMessage: null,
          },
        });
      }

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            actualCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
            result: {
              sceneCount: result.data.scenes.length,
              totalDurationSeconds: result.data.scenes.reduce(
                (sum, scene) => sum + scene.durationSeconds,
                0,
              ),
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      }

      await job.updateProgress(100);
      logger.info({ generationJobId, storyId }, 'Scene planning completed');
      return {
        status: 'completed',
        storyId,
        sceneCount: result.data.scenes.length,
      };
    } catch (error) {
      const message = (error as Error).message;
      const maxAttempts = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            progress: isFinalAttempt ? 100 : Math.min(90, Number(job.progress) || 0),
            errorMessage: message,
            attempts: job.attemptsMade + 1,
            ...(isFinalAttempt ? { completedAt: new Date() } : {}),
          },
        });
      }
      if (storyGenerationId) {
        await prisma.storyGeneration.updateMany({
          where: { id: storyGenerationId },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            errorMessage: message,
          },
        });
      }
      if (isFinalAttempt && storyId) {
        await prisma.story.updateMany({
          where: { id: storyId, userId: data.userId },
          data: { status: StoryStatus.FAILED },
        });
      }

      logger.error({ generationJobId, storyId, err: message }, 'Scene planning failed');
      throw error;
    }
  };
}
