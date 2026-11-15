import type { Job, Processor } from 'bullmq';
import { JobStatus, MotionGenerationStatus, Prisma } from '@prisma/client';
import {
  JOB_TYPE_TO_QUEUE,
  QUEUE_NAMES,
  type GenerationQueuePayload,
  type MotionJobAction,
} from '@ai-video/shared';
import { analyzeMotion } from '../lib/gemini';
import { enqueueGenerationJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { shouldUseVideoProviderMock } from '../lib/video-providers';

export function createMotionAnalysisProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const motionGenerationId =
      data.motionGenerationId ??
      (typeof payload.motionGenerationId === 'string' ? payload.motionGenerationId : undefined);

    logger.info(
      {
        bullJobId: job.id,
        generationJobId,
        storyId: data.storyId,
        motionGenerationId,
        attempt: job.attemptsMade + 1,
      },
      'Motion analysis started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        if (motionGenerationId) {
          await prisma.motionGeneration.updateMany({
            where: { id: motionGenerationId, status: { not: MotionGenerationStatus.COMPLETED } },
            data: { status: MotionGenerationStatus.CANCELLED, errorMessage: 'Cancelled by user' },
          });
        }
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

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in motion-analysis');
      }

      const motionIds =
        (Array.isArray(payload.motionGenerationIds)
          ? payload.motionGenerationIds.filter((id): id is string => typeof id === 'string')
          : undefined) ?? (motionGenerationId ? [motionGenerationId] : []);

      if (motionIds.length === 0) {
        throw new Error('motionGenerationId(s) required for motion analysis');
      }

      const motions = await prisma.motionGeneration.findMany({
        where: { id: { in: motionIds }, userId: data.userId },
        include: {
          scene: true,
          sourceVisual: true,
          story: {
            include: {
              characters: { orderBy: { name: 'asc' } },
              visualStyle: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (motions.length === 0) {
        throw new Error('No motion generations found for analysis');
      }

      await prisma.motionGeneration.updateMany({
        where: { id: { in: motions.map((m) => m.id) } },
        data: {
          status: MotionGenerationStatus.ANALYZING,
          progress: 20,
          errorMessage: null,
          errorCode: null,
        },
      });

      const skipAnalysis = payload.skipAnalysis === true;
      const customPrompt =
        typeof payload.motionPrompt === 'string' ? payload.motionPrompt.trim() : '';

      let analyzedBySceneNumber = new Map<
        number,
        {
          motionPrompt: string;
          negativePrompt: string;
          structuredBrief: Record<string, unknown>;
        }
      >();

      if (!skipAnalysis && !customPrompt) {
        const story = motions[0].story;
        const uniqueScenes = new Map(
          motions.map((motion) => [motion.scene.sceneNumber, motion.scene]),
        );

        const result = await analyzeMotion(
          {
            title: story.title,
            story: story.content,
            defaultDurationSeconds: motions[0].durationSeconds,
            styleName: story.visualStyle?.name,
            styleNotes:
              story.visualStyle &&
              typeof story.visualStyle.configuration === 'object' &&
              story.visualStyle.configuration
                ? JSON.stringify(story.visualStyle.configuration)
                : null,
            characters: story.characters.map((character) => ({
              name: character.name,
              appearance: character.appearance,
              clothing: character.clothing,
              ageRange: character.ageRange,
              hair: character.hair,
              distinctiveFeatures: character.distinctiveFeatures,
              consistencyNotes: character.consistencyNotes,
              canonicalVisualDescription: character.canonicalVisualDescription,
            })),
            scenes: [...uniqueScenes.values()].map((scene) => {
              const motion = motions.find((item) => item.sceneId === scene.id);
              return {
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
                selectedVisualPrompt: motion?.sourceVisual.visualPrompt,
                structuredBrief:
                  motion?.sourceVisual.structuredBrief &&
                  typeof motion.sourceVisual.structuredBrief === 'object'
                    ? (motion.sourceVisual.structuredBrief as Record<string, unknown>)
                    : null,
              };
            }),
          },
          { forceMock: data.useMockAi === true },
        );

        await prisma.providerUsage.create({
          data: {
            userId: data.userId,
            storyId: data.storyId ?? motions[0].storyId,
            generationJobId,
            provider: 'gemini',
            model: result.usage.model,
            requestType: 'motion_analysis',
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            estimatedCost: new Prisma.Decimal(result.usage.estimatedCostUsd),
            metadata: {
              action: 'analyze_story_motion' satisfies MotionJobAction,
              motionGenerationIds: motions.map((m) => m.id),
              sceneIds: motions.map((m) => m.sceneId),
            },
          },
        });

        analyzedBySceneNumber = new Map(
          result.data.scenes.map((brief) => [
            brief.sceneNumber,
            {
              motionPrompt: brief.motionPrompt,
              negativePrompt: brief.negativePrompt,
              structuredBrief: brief as unknown as Record<string, unknown>,
            },
          ]),
        );
      }

      const chainedJobs: string[] = [];

      for (const motion of motions) {
        if (motion.status === MotionGenerationStatus.CANCELLED) {
          continue;
        }

        const analyzed = analyzedBySceneNumber.get(motion.scene.sceneNumber);
        const motionPrompt =
          customPrompt ||
          analyzed?.motionPrompt ||
          motion.motionPrompt ||
          motion.scene.videoPrompt;
        const negativePrompt =
          (typeof payload.negativePrompt === 'string' ? payload.negativePrompt : undefined) ||
          analyzed?.negativePrompt ||
          motion.negativePrompt;

        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: {
            motionPrompt,
            negativePrompt,
            structuredBrief: (analyzed?.structuredBrief ??
              motion.structuredBrief ??
              undefined) as Prisma.InputJsonValue | undefined,
            status: MotionGenerationStatus.SUBMITTING,
            progress: 40,
          },
        });

        const videoProvider =
          motion.provider || process.env.VIDEO_GENERATION_PROVIDER || 'hailuo';

        const videoJob = await prisma.generationJob.create({
          data: {
            userId: data.userId,
            storyId: motion.storyId,
            jobType: 'VIDEO',
            status: JobStatus.PENDING,
            provider: videoProvider,
            queueName: JOB_TYPE_TO_QUEUE.VIDEO,
            maxAttempts: 3,
            payload: {
              action: 'submit_image_to_video' satisfies MotionJobAction,
              motionGenerationId: motion.id,
              sceneId: motion.sceneId,
              sourceVisualId: motion.sourceVisualId,
              provider: videoProvider,
            } as Prisma.InputJsonValue,
          },
        });

        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: { generationJobId: videoJob.id },
        });

        const { queueJobId } = await enqueueGenerationJob(
          QUEUE_NAMES.VIDEO_GENERATION,
          'VIDEO',
          {
            generationJobId: videoJob.id,
            userId: data.userId,
            storyId: motion.storyId,
            sceneId: motion.sceneId,
            sceneVisualId: motion.sourceVisualId,
            motionGenerationId: motion.id,
            jobType: 'VIDEO',
            provider: videoProvider,
            payload: {
              action: 'submit_image_to_video',
              motionGenerationId: motion.id,
              provider: videoProvider,
            },
            // Never inherit Gemini/analysis mock into Hailuo/Kling generation.
            useMockAi: shouldUseVideoProviderMock(videoProvider),
            simulateFailure: data.simulateFailure,
          },
        );

        await prisma.generationJob.update({
          where: { id: videoJob.id },
          data: {
            status: JobStatus.QUEUED,
            queueJobId,
          },
        });

        chainedJobs.push(videoJob.id);
      }

      if (generationJobId) {
        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            completedAt: new Date(),
            result: {
              motionGenerationIds: motions.map((m) => m.id),
              chainedVideoJobIds: chainedJobs,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        status: 'completed',
        motionGenerationIds: motions.map((m) => m.id),
        chainedVideoJobIds: chainedJobs,
      };
    } catch (error) {
      const message = (error as Error).message || 'Motion analysis failed';
      logger.error({ err: error, generationJobId, motionGenerationId }, message);

      if (motionGenerationId) {
        await prisma.motionGeneration.updateMany({
          where: {
            id: motionGenerationId,
            status: { notIn: [MotionGenerationStatus.COMPLETED, MotionGenerationStatus.CANCELLED] },
          },
          data: {
            status: MotionGenerationStatus.FAILED,
            errorMessage: message,
            errorCode: 'MOTION_ANALYSIS_FAILED',
          },
        });
      } else if (Array.isArray(payload.motionGenerationIds)) {
        await prisma.motionGeneration.updateMany({
          where: {
            id: {
              in: payload.motionGenerationIds.filter(
                (id): id is string => typeof id === 'string',
              ),
            },
            status: { notIn: [MotionGenerationStatus.COMPLETED, MotionGenerationStatus.CANCELLED] },
          },
          data: {
            status: MotionGenerationStatus.FAILED,
            errorMessage: message,
            errorCode: 'MOTION_ANALYSIS_FAILED',
          },
        });
      }

      if (generationJobId) {
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            errorMessage: message,
            ...(isFinalAttempt ? { completedAt: new Date() } : {}),
          },
        });
      }

      throw error;
    }
  };
}
