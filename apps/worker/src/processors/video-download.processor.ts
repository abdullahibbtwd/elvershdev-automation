import { randomUUID } from 'node:crypto';
import type { Job, Processor } from 'bullmq';
import { JobStatus, MediaType, MotionGenerationStatus, Prisma } from '@prisma/client';
import type { MotionDownloadQueuePayload } from '@ai-video/shared';
import { getKlingTaskStatus, retrieveCompletedKlingVideo, shouldUseKlingMock } from '../lib/kling';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { deleteObject, uploadObject } from '../lib/storage';
import { validateVideoBuffer } from '../lib/video-validation';
import { FfmpegService } from '../lib/ffmpeg';

export function createVideoDownloadProcessor(logger: Logger): Processor {
  return async (job: Job<MotionDownloadQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    let uploadedKey: string | undefined;

    logger.info(
      {
        bullJobId: job.id,
        motionGenerationId: data.motionGenerationId,
        providerTaskId: data.providerTaskId,
        attempt: job.attemptsMade + 1,
      },
      'Video download started',
    );

    const motion = await prisma.motionGeneration.findFirst({
      where: { id: data.motionGenerationId, userId: data.userId },
      include: {
        story: {
          include: {
            videoProjects: {
              select: { id: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!motion) {
      throw new Error('Motion generation not found');
    }

    if (
      motion.status === MotionGenerationStatus.COMPLETED &&
      motion.outputMediaAssetId
    ) {
      return { status: 'already_completed', mediaAssetId: motion.outputMediaAssetId };
    }

    if (motion.status === MotionGenerationStatus.CANCELLED) {
      return { status: 'cancelled' };
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in video-download');
      }

      const downloading = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          status: MotionGenerationStatus.DOWNLOADING,
          progress: 88,
          errorMessage: null,
          errorCode: null,
        },
      });
      if (downloading.count === 0) {
        return { status: 'cancelled' };
      }

      if (data.generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
          data: { progress: 88 },
        });
      }

      const forceMock = data.useMockAi === true || shouldUseKlingMock();
      if (forceMock) {
        process.env.KLING_USE_MOCK = 'true';
      }

      const status =
        data.videoUrl && !forceMock
          ? {
              providerTaskId: data.providerTaskId,
              status: 'succeeded' as const,
              outputs: [
                {
                  type: 'video' as const,
                  url: data.videoUrl,
                },
              ],
              mock: false,
            }
          : await getKlingTaskStatus(data.providerTaskId);

      if (status.status !== 'succeeded' || status.outputs.length === 0) {
        throw new Error(status.message || 'Provider video not ready for download');
      }

      const retrieved = await retrieveCompletedKlingVideo(status);

      const validating = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          status: MotionGenerationStatus.VALIDATING,
          progress: 92,
        },
      });
      if (validating.count === 0) {
        return { status: 'cancelled' };
      }

      const validation = await validateVideoBuffer(retrieved.buffer, {
        expectedMimeType: retrieved.mimeType || 'video/mp4',
        ffmpeg: new FfmpegService(),
      });

      if (!validation.valid) {
        throw new Error(validation.errorMessage || 'Generated video failed validation');
      }

      const projectId = motion.story.videoProjects[0]?.id ?? 'none';
      const assetId = randomUUID();
      const storageKey = `users/${motion.userId}/projects/${projectId}/stories/${motion.storyId}/scenes/${motion.sceneId}/motion/${motion.id}.mp4`;
      uploadedKey = storageKey;

      await uploadObject(storageKey, retrieved.buffer, retrieved.mimeType || 'video/mp4');

      const mediaAsset = await prisma.mediaAsset.create({
        data: {
          id: assetId,
          userId: motion.userId,
          videoProjectId: projectId !== 'none' ? projectId : null,
          type: MediaType.VIDEO,
          storageKey,
          originalName: `${motion.id}.mp4`,
          mimeType: retrieved.mimeType || 'video/mp4',
          fileSize: BigInt(retrieved.contentLength),
          metadata: {
            kind: 'scene_motion_clip',
            storyId: motion.storyId,
            sceneId: motion.sceneId,
            motionGenerationId: motion.id,
            sourceVisualId: motion.sourceVisualId,
            provider: motion.provider,
            providerModel: motion.providerModel,
            providerTaskId: motion.providerTaskId,
            durationSeconds: validation.metadata.durationSeconds,
            width: validation.metadata.width,
            height: validation.metadata.height,
            frameRate: validation.metadata.frameRate,
            videoCodec: validation.metadata.videoCodec,
            audioCodec: validation.metadata.audioCodec,
            containerFormat: validation.metadata.containerFormat,
            hasAudio: validation.metadata.hasAudio,
            resolution: motion.resolution,
          } as Prisma.InputJsonValue,
        },
      });

      const completed = await prisma.$transaction(async (tx) => {
        await tx.motionGeneration.updateMany({
          where: {
            sceneId: motion.sceneId,
            isSelected: true,
            id: { not: motion.id },
          },
          data: { isSelected: false },
        });

        const updated = await tx.motionGeneration.updateMany({
          where: {
            id: motion.id,
            status: { notIn: [MotionGenerationStatus.CANCELLED] },
          },
          data: {
            status: MotionGenerationStatus.COMPLETED,
            progress: 100,
            outputMediaAssetId: mediaAsset.id,
            isSelected: true,
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            ...(status.actualCostUsd != null
              ? {
                  actualCost: new Prisma.Decimal(status.actualCostUsd),
                  currency: status.currency || motion.currency,
                }
              : {}),
          },
        });
        return updated.count > 0;
      });

      if (!completed) {
        try {
          await deleteObject(storageKey);
          await prisma.mediaAsset.delete({ where: { id: mediaAsset.id } }).catch(() => undefined);
        } catch {
          // best-effort cleanup
        }
        return { status: 'cancelled' };
      }

      await prisma.providerUsage.create({
        data: {
          userId: motion.userId,
          storyId: motion.storyId,
          generationJobId: data.generationJobId,
          provider: 'kling',
          model: motion.providerModel || 'kling',
          requestType: 'image_to_video_complete',
          estimatedCost: motion.estimatedCost ?? new Prisma.Decimal(0),
          metadata: {
            motionGenerationId: motion.id,
            sceneId: motion.sceneId,
            providerTaskId: motion.providerTaskId,
            mediaAssetId: mediaAsset.id,
            durationSeconds: validation.metadata.durationSeconds,
            resolution: motion.resolution,
            fileSize: retrieved.contentLength,
            actualCost: status.actualCostUsd ?? null,
            estimated: status.actualCostUsd == null,
          },
        },
      });

      if (data.generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            completedAt: new Date(),
            actualCost: status.actualCostUsd != null
              ? new Prisma.Decimal(status.actualCostUsd)
              : motion.estimatedCost,
            result: {
              motionGenerationId: motion.id,
              mediaAssetId: mediaAsset.id,
              storageKey,
              validation: validation.metadata,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        status: 'completed',
        mediaAssetId: mediaAsset.id,
        storageKey,
      };
    } catch (error) {
      const message = (error as Error).message || 'Video download failed';
      logger.error(
        { err: error, motionGenerationId: data.motionGenerationId },
        message,
      );

      if (uploadedKey) {
        try {
          await deleteObject(uploadedKey);
        } catch {
          // avoid orphaned objects best-effort
        }
      }

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
      if (isFinalAttempt) {
        await prisma.motionGeneration.updateMany({
          where: {
            id: data.motionGenerationId,
            status: {
              notIn: [MotionGenerationStatus.COMPLETED, MotionGenerationStatus.CANCELLED],
            },
          },
          data: {
            status: MotionGenerationStatus.FAILED,
            errorCode: 'VIDEO_DOWNLOAD_FAILED',
            errorMessage: message,
            completedAt: new Date(),
          },
        });

        if (data.generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
            data: {
              status: JobStatus.FAILED,
              errorMessage: message,
              completedAt: new Date(),
            },
          });
        }
      }

      throw error;
    }
  };
}
