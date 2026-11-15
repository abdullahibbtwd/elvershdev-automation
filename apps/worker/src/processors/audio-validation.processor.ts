import type { Job, Processor } from 'bullmq';
import { AudioGenerationStatus, JobStatus } from '@prisma/client';
import type { AudioPipelineQueuePayload } from '@ai-video/shared';
import { validateAudioBuffer } from '../lib/audio-validation';
import { enqueueAudioStorageJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { downloadObject } from '../lib/storage';

export function createAudioValidationProcessor(logger: Logger): Processor {
  return async (job: Job<AudioPipelineQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const { audioGenerationId, generationJobId, tempObjectKey } = data;

    logger.info(
      { bullJobId: job.id, audioGenerationId, generationJobId, attempt: job.attemptsMade + 1 },
      'Audio validation started',
    );

    const audio = await prisma.audioGeneration.findUnique({
      where: { id: audioGenerationId },
    });
    if (!audio) {
      throw new Error(`AudioGeneration ${audioGenerationId} not found`);
    }

    if (audio.status === AudioGenerationStatus.COMPLETED && !data.forceRegenerate) {
      return { status: 'already_completed' };
    }

    if (generationJobId) {
      const parent = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (parent?.status === JobStatus.CANCELLED) {
        await prisma.audioGeneration.updateMany({
          where: { id: audioGenerationId },
          data: { status: AudioGenerationStatus.CANCELLED, completedAt: new Date() },
        });
        return { status: 'cancelled' };
      }
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in audio-validation');
      }
      if (!tempObjectKey) {
        throw new Error('tempObjectKey is required for audio validation');
      }

      await prisma.audioGeneration.update({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.VALIDATING,
          progress: 55,
          errorCode: null,
          errorMessage: null,
        },
      });

      const objectBytes = await downloadObject(tempObjectKey);
      const maxDuration = parseInt(process.env.GEMINI_TTS_MAX_AUDIO_DURATION_SECONDS ?? '600', 10);
      const validation = await validateAudioBuffer(objectBytes, {
        expectedMimeType: 'audio/wav',
        maxDurationSeconds: Number.isFinite(maxDuration) ? maxDuration : 600,
      });

      if (!validation.valid) {
        throw new Error(validation.errorMessage || 'Audio validation failed');
      }

      await prisma.audioGeneration.update({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.STORING,
          progress: 70,
          duration: validation.metadata.durationSeconds,
          sampleRate: validation.metadata.sampleRate,
          channels: validation.metadata.channels,
          format: validation.metadata.containerFormat?.includes('wav')
            ? 'wav'
            : audio.format || 'wav',
          fileSize: BigInt(validation.metadata.fileSize),
        },
      });

      await enqueueAudioStorageJob({
        ...data,
        tempObjectKey,
      });

      await job.updateProgress(100);
      return {
        status: 'validated',
        durationSeconds: validation.metadata.durationSeconds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, audioGenerationId }, 'Audio validation failed');

      await prisma.audioGeneration.updateMany({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.FAILED,
          errorCode: 'AUDIO_VALIDATION_FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });

      if (generationJobId) {
        const remaining = await prisma.audioGeneration.count({
          where: {
            generationJobId,
            status: {
              in: [
                AudioGenerationStatus.PENDING,
                AudioGenerationStatus.GENERATING,
                AudioGenerationStatus.VALIDATING,
                AudioGenerationStatus.STORING,
              ],
            },
          },
        });
        if (remaining === 0) {
          await prisma.generationJob.updateMany({
            where: { id: generationJobId },
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
