import type { Job, Processor } from 'bullmq';
import { JobStatus, MotionGenerationStatus, Prisma } from '@prisma/client';
import type { GenerationQueuePayload } from '@ai-video/shared';
import { estimateKlingVideoCostUsd, getKlingPricingFromEnv } from '@ai-video/shared';
import { enqueueMotionPollJob } from '../lib/enqueue';
import { getKlingModel, klingVideoProvider, shouldUseKlingMock } from '../lib/kling';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  downloadObject,
  getMinioEndpoint,
  getPresignedDownloadUrl,
} from '../lib/storage';

function isPubliclyFetchableEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '0.0.0.0' &&
      host !== 'minio' &&
      !host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

async function resolveImageInput(storageKey: string): Promise<{
  imageUrl: string;
  imageBase64?: string;
}> {
  const publicBase =
    process.env.MINIO_PUBLIC_URL?.trim() || process.env.SOCIAL_PUBLIC_MEDIA_BASE_URL?.trim();
  const endpoint = getMinioEndpoint();

  if (publicBase || isPubliclyFetchableEndpoint(endpoint)) {
    return { imageUrl: await getPresignedDownloadUrl(storageKey, 3600) };
  }

  // Local MinIO is not reachable by Kling — send base64 first-frame payload.
  const buffer = await downloadObject(storageKey);
  return {
    imageUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    imageBase64: buffer.toString('base64'),
  };
}

function getPollIntervalSeconds(): number {
  const parsed = Number.parseInt(process.env.KLING_POLL_INTERVAL_SECONDS ?? '8', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function getMaxPollAttempts(): number {
  const parsed = Number.parseInt(process.env.KLING_MAX_POLL_ATTEMPTS ?? '90', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

export function createVideoGenerationProcessor(logger: Logger): Processor {
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
        motionGenerationId,
        attempt: job.attemptsMade + 1,
      },
      'Video generation submit started',
    );

    if (!motionGenerationId) {
      throw new Error('motionGenerationId is required for video generation');
    }

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        await prisma.motionGeneration.updateMany({
          where: { id: motionGenerationId, status: { not: MotionGenerationStatus.COMPLETED } },
          data: { status: MotionGenerationStatus.CANCELLED, errorMessage: 'Cancelled by user' },
        });
        return { status: 'cancelled' };
      }

      await prisma.generationJob.updateMany({
        where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
        data: {
          status: JobStatus.PROCESSING,
          progress: 20,
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in video-generation');
      }

      const motion = await prisma.motionGeneration.findFirst({
        where: { id: motionGenerationId, userId: data.userId },
        include: {
          sourceMediaAsset: true,
          scene: { select: { id: true, storyId: true } },
        },
      });

      if (!motion) {
        throw new Error('Motion generation not found');
      }

      if (motion.status === MotionGenerationStatus.CANCELLED) {
        return { status: 'cancelled' };
      }

      // Idempotency: if provider task already exists, resume polling instead of resubmitting.
      if (motion.providerTaskId) {
        logger.info(
          { motionGenerationId, providerTaskId: motion.providerTaskId },
          'Provider task already submitted; scheduling status poll',
        );

        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: {
            status: MotionGenerationStatus.PROCESSING,
            progress: 55,
          },
        });

        await enqueueMotionPollJob(
          {
            generationJobId: generationJobId || motion.generationJobId || motion.id,
            motionGenerationId: motion.id,
            userId: motion.userId,
            storyId: motion.storyId,
            sceneId: motion.sceneId,
            providerTaskId: motion.providerTaskId,
            pollAttempt: Math.max(motion.pollAttempt, 1),
            maxPollAttempts: getMaxPollAttempts(),
            pollIntervalSeconds: getPollIntervalSeconds(),
            useMockAi: data.useMockAi ?? shouldUseKlingMock(),
          },
          getPollIntervalSeconds() * 1000,
        );

        if (generationJobId) {
          await prisma.generationJob.update({
            where: { id: generationJobId },
            data: {
              progress: 55,
              result: {
                providerTaskId: motion.providerTaskId,
                resumed: true,
              } as Prisma.InputJsonValue,
            },
          });
        }

        return { status: 'polling', providerTaskId: motion.providerTaskId };
      }

      const submitting = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          status: MotionGenerationStatus.SUBMITTING,
          progress: 45,
          errorMessage: null,
          errorCode: null,
        },
      });
      if (submitting.count === 0) {
        return { status: 'cancelled' };
      }

      const imageInput = await resolveImageInput(motion.sourceMediaAsset.storageKey);
      const model = motion.providerModel || getKlingModel();
      const forceMock = data.useMockAi === true || shouldUseKlingMock();

      const submitResult = await klingVideoProvider.submitImageToVideo({
        imageUrl: imageInput.imageUrl,
        imageBase64: imageInput.imageBase64,
        motionPrompt: motion.motionPrompt,
        negativePrompt: motion.negativePrompt ?? undefined,
        durationSeconds: motion.durationSeconds,
        resolution: motion.resolution,
        model,
        externalTaskId: motion.id,
        audio: 'off',
      });

      // If forceMock was requested but provider wasn't in mock mode, re-submit with env override.
      const finalSubmit =
        forceMock && !submitResult.mock
          ? await (async () => {
              const previous = process.env.KLING_USE_MOCK;
              process.env.KLING_USE_MOCK = 'true';
              try {
                return await klingVideoProvider.submitImageToVideo({
                  imageUrl: imageInput.imageUrl,
                  imageBase64: imageInput.imageBase64,
                  motionPrompt: motion.motionPrompt,
                  negativePrompt: motion.negativePrompt ?? undefined,
                  durationSeconds: motion.durationSeconds,
                  resolution: motion.resolution,
                  model,
                  externalTaskId: motion.id,
                  audio: 'off',
                });
              } finally {
                if (previous === undefined) delete process.env.KLING_USE_MOCK;
                else process.env.KLING_USE_MOCK = previous;
              }
            })()
          : submitResult;

      const estimatedCost =
        finalSubmit.estimatedCostUsd ||
        estimateKlingVideoCostUsd(
          motion.durationSeconds,
          motion.resolution,
          getKlingPricingFromEnv(),
        );

      const processingUpdate = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          provider: 'kling',
          providerModel: finalSubmit.model,
          providerTaskId: finalSubmit.providerTaskId,
          status: MotionGenerationStatus.PROCESSING,
          progress: 55,
          estimatedCost: new Prisma.Decimal(estimatedCost),
          currency: finalSubmit.currency || 'USD',
          submittedAt: new Date(),
          pollAttempt: 0,
          generationParameters: {
            durationSeconds: motion.durationSeconds,
            resolution: motion.resolution,
            audio: 'off',
            mock: Boolean(finalSubmit.mock),
            externalTaskId: motion.id,
          } as Prisma.InputJsonValue,
        },
      });
      if (processingUpdate.count === 0) {
        return { status: 'cancelled' };
      }

      await prisma.providerUsage.create({
        data: {
          userId: motion.userId,
          storyId: motion.storyId,
          generationJobId,
          provider: 'kling',
          model: finalSubmit.model,
          requestType: 'image_to_video_submit',
          estimatedCost: new Prisma.Decimal(estimatedCost),
          metadata: {
            motionGenerationId: motion.id,
            sceneId: motion.sceneId,
            providerTaskId: finalSubmit.providerTaskId,
            durationSeconds: motion.durationSeconds,
            resolution: motion.resolution,
            estimated: true,
          },
        },
      });

      await enqueueMotionPollJob(
        {
          generationJobId: generationJobId || motion.generationJobId || motion.id,
          motionGenerationId: motion.id,
          userId: motion.userId,
          storyId: motion.storyId,
          sceneId: motion.sceneId,
          providerTaskId: finalSubmit.providerTaskId,
          pollAttempt: 1,
          maxPollAttempts: getMaxPollAttempts(),
          pollIntervalSeconds: getPollIntervalSeconds(),
          useMockAi: forceMock,
        },
        getPollIntervalSeconds() * 1000,
      );

      if (generationJobId) {
        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: {
            progress: 55,
            estimatedCost: new Prisma.Decimal(estimatedCost),
            result: {
              providerTaskId: finalSubmit.providerTaskId,
              submitted: true,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        status: 'submitted',
        providerTaskId: finalSubmit.providerTaskId,
      };
    } catch (error) {
      const message = (error as Error).message || 'Video generation submit failed';
      logger.error({ err: error, generationJobId, motionGenerationId }, message);

      await prisma.motionGeneration.updateMany({
        where: {
          id: motionGenerationId,
          status: { notIn: [MotionGenerationStatus.COMPLETED, MotionGenerationStatus.CANCELLED] },
        },
        data: {
          status: MotionGenerationStatus.FAILED,
          errorMessage: message,
          errorCode: 'VIDEO_SUBMIT_FAILED',
        },
      });

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
