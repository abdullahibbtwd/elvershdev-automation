import type { Job, Processor } from 'bullmq';
import { JobStatus, MotionGenerationStatus, Prisma } from '@prisma/client';
import type { GenerationQueuePayload } from '@ai-video/shared';
import { estimateVideoGenerationCostUsd } from '@ai-video/shared';
import { enqueueMotionPollJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  downloadObject,
  getMinioEndpoint,
  getPresignedDownloadUrl,
} from '../lib/storage';
import {
  getVideoMaxPollAttempts,
  getVideoPollIntervalSeconds,
  resolveVideoProvider,
  resolveVideoProviderId,
  shouldUseVideoProviderMock,
} from '../lib/video-providers';

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

/**
 * Resolve a source image for the selected video provider.
 * - Public/presigned MinIO URLs when the endpoint is reachable by external providers.
 * - Otherwise download bytes for fal.storage upload (Hailuo) or base64 (Kling).
 * Presign TTL is long enough for provider processing (Hailuo timeout + buffer).
 */
async function resolveImageInput(storageKey: string, providerId: string): Promise<{
  imageUrl: string;
  imageBase64?: string;
  imageBytes?: Uint8Array;
  imageMimeType?: string;
}> {
  const publicBase =
    process.env.MINIO_PUBLIC_URL?.trim() || process.env.SOCIAL_PUBLIC_MEDIA_BASE_URL?.trim();
  const endpoint = getMinioEndpoint();
  const hailuoTimeoutMs = Number.parseInt(process.env.HAILUO_TIMEOUT_MS ?? '600000', 10);
  const presignTtlSeconds = Math.max(
    3600,
    Math.ceil(((Number.isFinite(hailuoTimeoutMs) ? hailuoTimeoutMs : 600_000) + 600_000) / 1000),
  );

  if (publicBase || isPubliclyFetchableEndpoint(endpoint)) {
    return {
      imageUrl: await getPresignedDownloadUrl(storageKey, presignTtlSeconds),
    };
  }

  const buffer = await downloadObject(storageKey);

  if (providerId === 'hailuo') {
    // Hailuo requires HTTP(S) image_url — provider will upload bytes via fal.storage.
    return {
      imageUrl: `local://minio/${storageKey}`,
      imageBytes: buffer,
      imageMimeType: 'image/png',
      imageBase64: buffer.toString('base64'),
    };
  }

  // Kling can accept base64 first-frame payloads when MinIO is not publicly reachable.
  return {
    imageUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    imageBase64: buffer.toString('base64'),
  };
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

      const providerId = resolveVideoProviderId(
        motion.provider || data.provider || process.env.VIDEO_GENERATION_PROVIDER,
      );
      const provider = resolveVideoProvider(providerId);
      const pollIntervalSeconds = getVideoPollIntervalSeconds(providerId);
      const maxPollAttempts = getVideoMaxPollAttempts(providerId);

      // Idempotency: if provider task already exists, resume polling instead of resubmitting.
      if (motion.providerTaskId) {
        logger.info(
          { motionGenerationId, providerTaskId: motion.providerTaskId, provider: providerId },
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
            maxPollAttempts,
            pollIntervalSeconds,
            useMockAi: data.useMockAi ?? shouldUseVideoProviderMock(providerId),
            provider: providerId,
          },
          pollIntervalSeconds * 1000,
        );

        if (generationJobId) {
          await prisma.generationJob.update({
            where: { id: generationJobId },
            data: {
              progress: 55,
              result: {
                providerTaskId: motion.providerTaskId,
                provider: providerId,
                resumed: true,
              } as Prisma.InputJsonValue,
            },
          });
        }

        return { status: 'polling', providerTaskId: motion.providerTaskId, provider: providerId };
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

      const imageInput = await resolveImageInput(motion.sourceMediaAsset.storageKey, providerId);
      const model = motion.providerModel || provider.getModel();
      const forceMock = data.useMockAi === true || shouldUseVideoProviderMock(providerId);

      const submitInput = {
        imageUrl: imageInput.imageUrl,
        imageBase64: imageInput.imageBase64,
        imageBytes: imageInput.imageBytes,
        imageMimeType: imageInput.imageMimeType,
        motionPrompt: motion.motionPrompt,
        negativePrompt: motion.negativePrompt ?? undefined,
        durationSeconds: motion.durationSeconds,
        resolution: motion.resolution,
        model,
        externalTaskId: motion.id,
        audio: 'off' as const,
      };

      let finalSubmit = await provider.submitImageToVideo(submitInput);

      if (forceMock && !finalSubmit.mock) {
        const mockEnvKey = providerId === 'kling' ? 'KLING_USE_MOCK' : 'HAILUO_USE_MOCK';
        const previous = process.env[mockEnvKey];
        process.env[mockEnvKey] = 'true';
        try {
          finalSubmit = await provider.submitImageToVideo(submitInput);
        } finally {
          if (previous === undefined) delete process.env[mockEnvKey];
          else process.env[mockEnvKey] = previous;
        }
      }

      const estimatedCost =
        finalSubmit.estimatedCostUsd ||
        estimateVideoGenerationCostUsd(
          providerId,
          motion.durationSeconds,
          motion.resolution,
        );

      const processingUpdate = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          provider: providerId,
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
            provider: providerId,
            requestId: finalSubmit.requestId ?? finalSubmit.providerTaskId,
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
          provider: providerId,
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
            costKind: 'estimated',
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
          maxPollAttempts,
          pollIntervalSeconds,
          useMockAi: forceMock,
          provider: providerId,
        },
        pollIntervalSeconds * 1000,
      );

      if (generationJobId) {
        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: {
            progress: 55,
            provider: providerId,
            estimatedCost: new Prisma.Decimal(estimatedCost),
            result: {
              providerTaskId: finalSubmit.providerTaskId,
              provider: providerId,
              submitted: true,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        status: 'submitted',
        providerTaskId: finalSubmit.providerTaskId,
        provider: providerId,
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
