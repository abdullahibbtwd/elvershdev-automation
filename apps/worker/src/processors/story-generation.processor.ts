import type { Job, Processor } from 'bullmq';
import { JobStatus, Prisma, StoryStatus } from '@prisma/client';
import {
  JOB_TYPE_TO_QUEUE,
  storyBriefSchema,
  type GenerationQueuePayload,
  type GeneratedStory,
  type StoryBriefInput,
} from '@ai-video/shared';
import { generateStoryContent } from '../lib/gemini';
import { getPrisma } from '../lib/prisma';
import type { Logger } from '../lib/logger';

function asBrief(payload: Record<string, unknown> | undefined): StoryBriefInput {
  return storyBriefSchema.parse(payload?.brief ?? payload);
}

export function createStoryGenerationProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const storyId = data.storyId;
    const storyGenerationId = data.storyGenerationId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    logger.info(
      { bullJobId: job.id, generationJobId, storyId, attempt: job.attemptsMade + 1 },
      'Story generation started',
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
    if (storyId) {
      await prisma.story.updateMany({
        where: { id: storyId, userId: data.userId },
        data: { status: StoryStatus.GENERATING },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in story-generation');
      }

      // Placeholder / legacy STORY jobs without a story brief
      if (!storyId || !payload.brief) {
        await job.updateProgress(100);
        if (generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
            data: {
              status: JobStatus.COMPLETED,
              progress: 100,
              result: {
                status: 'completed',
                placeholder: true,
                queue: 'story-generation',
              } as Prisma.InputJsonValue,
              actualCost: 0,
              completedAt: new Date(),
              errorMessage: null,
            },
          });
        }
        return { status: 'completed', placeholder: true };
      }

      const brief = asBrief(payload);
      await job.updateProgress(30);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: { progress: 30 },
        });
      }

      const result = await generateStoryContent(brief, {
        forceMock: Boolean(data.useMockAi) || process.env.NODE_ENV === 'test',
      });

      await job.updateProgress(70);

      const generated = result.data;
      await applyGeneratedStory(prisma, storyId, data.userId, generated, brief);

      await prisma.providerUsage.create({
        data: {
          userId: data.userId,
          storyId,
          generationJobId: generationJobId ?? undefined,
          provider: 'gemini',
          model: result.usage.model,
          requestType: 'story_generation',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
          metadata: {
            action: payload.action ?? 'generate_story',
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
            result: generated as unknown as Prisma.InputJsonValue,
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
              title: generated.title,
              characterCount: generated.characters.length,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      }

      await job.updateProgress(100);

      // Auto-chain scene planning after successful story generation
      const sceneJob = await enqueueScenePlanning({
        userId: data.userId,
        storyId,
        brief,
        generatedStory: generated,
        forceMock: Boolean(data.useMockAi) || process.env.NODE_ENV === 'test',
        logger,
      });

      logger.info(
        { generationJobId, storyId, sceneJobId: sceneJob?.id },
        'Story generation completed; scene planning enqueued',
      );

      return {
        status: 'completed',
        storyId,
        sceneJobId: sceneJob?.id ?? null,
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

      logger.error({ generationJobId, storyId, err: message }, 'Story generation failed');
      throw error;
    }
  };
}

async function applyGeneratedStory(
  prisma: ReturnType<typeof getPrisma>,
  storyId: string,
  userId: string,
  generated: GeneratedStory,
  brief: StoryBriefInput,
) {
  await prisma.story.updateMany({
    where: { id: storyId, userId },
    data: {
      title: generated.title,
      content: generated.story,
      openingHook: generated.openingHook,
      narrationScript: generated.narrationScript,
      closingMessage: generated.closingMessage,
      description: generated.description,
      hashtags: generated.hashtags,
      topic: brief.topic,
      niche: brief.niche,
      targetAudience: brief.targetAudience,
      language: brief.language,
      tone: brief.tone,
      category: brief.category,
      targetDurationSeconds: brief.desiredDurationSeconds,
      // Stay GENERATING until scenes complete; scene processor sets READY
      status: StoryStatus.GENERATING,
    },
  });

  await prisma.characterProfile.deleteMany({ where: { storyId } });
  if (generated.characters.length > 0) {
    await prisma.characterProfile.createMany({
      data: generated.characters.map((character) => ({
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
}

async function enqueueScenePlanning(input: {
  userId: string;
  storyId: string;
  brief: StoryBriefInput;
  generatedStory: GeneratedStory;
  forceMock: boolean;
  logger: Logger;
}) {
  const prisma = getPrisma();
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;

  const connection = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  try {
    const active = await prisma.generationJob.findFirst({
      where: {
        storyId: input.storyId,
        jobType: 'SCENE_PLANNING',
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active) {
      input.logger.info({ storyId: input.storyId, jobId: active.id }, 'Scene planning already active');
      return active;
    }

    const queueName = JOB_TYPE_TO_QUEUE.SCENE_PLANNING;
    const job = await prisma.generationJob.create({
      data: {
        userId: input.userId,
        storyId: input.storyId,
        jobType: 'SCENE_PLANNING',
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName,
        maxAttempts: 3,
        payload: {
          action: 'plan_scenes',
          brief: input.brief,
          generatedStory: input.generatedStory,
        } as Prisma.InputJsonValue,
      },
    });

    const generation = await prisma.storyGeneration.create({
      data: {
        userId: input.userId,
        storyId: input.storyId,
        generationJobId: job.id,
        requestType: 'SCENES',
        status: JobStatus.PENDING,
        promptParams: {
          action: 'plan_scenes',
          brief: input.brief,
        } as Prisma.InputJsonValue,
      },
    });

    const queue = new Queue(queueName, { connection });
    const bullJob = await queue.add(
      'scene_planning',
      {
        generationJobId: job.id,
        userId: input.userId,
        storyId: input.storyId,
        storyGenerationId: generation.id,
        jobType: 'SCENE_PLANNING',
        provider: 'gemini',
        payload: {
          action: 'plan_scenes',
          brief: input.brief,
          generatedStory: input.generatedStory,
        },
        useMockAi: input.forceMock,
      } satisfies GenerationQueuePayload,
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: JobStatus.QUEUED, queueJobId: bullJob.id },
    });
    await prisma.storyGeneration.update({
      where: { id: generation.id },
      data: { status: JobStatus.QUEUED },
    });

    await queue.close();
    return job;
  } finally {
    await connection.quit();
  }
}
