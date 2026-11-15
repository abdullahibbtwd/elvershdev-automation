import type { Job, Processor } from 'bullmq';
import { JobStatus, MotionGenerationStatus, Prisma } from '@prisma/client';
import type { MotionPollQueuePayload } from '@ai-video/shared';
import { enqueueMotionDownloadJob, enqueueMotionPollJob } from '../lib/enqueue';
import { getKlingTaskStatus, shouldUseKlingMock } from '../lib/kling';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';

export function createVideoStatusPollingProcessor(logger: Logger): Processor {
  return async (job: Job<MotionPollQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;

    logger.info(
      {
        bullJobId: job.id,
        motionGenerationId: data.motionGenerationId,
        providerTaskId: data.providerTaskId,
        pollAttempt: data.pollAttempt,
      },
      'Video status poll started',
    );

    const motion = await prisma.motionGeneration.findFirst({
      where: { id: data.motionGenerationId, userId: data.userId },
    });

    if (!motion) {
      logger.warn({ motionGenerationId: data.motionGenerationId }, 'Motion generation missing');
      return { status: 'missing' };
    }

    if (
      motion.status === MotionGenerationStatus.CANCELLED ||
      motion.status === MotionGenerationStatus.COMPLETED ||
      motion.status === MotionGenerationStatus.FAILED
    ) {
      return { status: motion.status.toLowerCase() };
    }

    if (data.generationJobId) {
      const generationJob = await prisma.generationJob.findUnique({
        where: { id: data.generationJobId },
        select: { status: true },
      });
      if (generationJob?.status === JobStatus.CANCELLED) {
        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: {
            status: MotionGenerationStatus.CANCELLED,
            errorMessage: 'Cancelled by user',
          },
        });
        return { status: 'cancelled' };
      }
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in video-status-polling');
      }

      const forceMock = data.useMockAi === true || shouldUseKlingMock();
      if (forceMock && !process.env.KLING_USE_MOCK) {
        process.env.KLING_USE_MOCK = 'true';
      }

      const status = await getKlingTaskStatus(data.providerTaskId);

      const progressUpdate = await prisma.motionGeneration.updateMany({
        where: {
          id: motion.id,
          status: { notIn: [MotionGenerationStatus.CANCELLED, MotionGenerationStatus.COMPLETED] },
        },
        data: {
          pollAttempt: data.pollAttempt,
          progress: Math.min(85, 55 + Math.floor((data.pollAttempt / data.maxPollAttempts) * 25)),
          status: MotionGenerationStatus.PROCESSING,
        },
      });
      if (progressUpdate.count === 0) {
        return { status: 'cancelled' };
      }

      if (status.status === 'succeeded') {
        const videoUrl = status.outputs[0]?.url;
        await enqueueMotionDownloadJob({
          generationJobId: data.generationJobId,
          motionGenerationId: motion.id,
          userId: data.userId,
          storyId: data.storyId,
          sceneId: data.sceneId,
          providerTaskId: data.providerTaskId,
          videoUrl,
          useMockAi: forceMock,
        });

        if (status.actualCostUsd != null) {
          await prisma.motionGeneration.update({
            where: { id: motion.id },
            data: {
              actualCost: new Prisma.Decimal(status.actualCostUsd),
              currency: status.currency || motion.currency,
            },
          });
        }

        return { status: 'succeeded', enqueuedDownload: true };
      }

      if (status.status === 'failed' || status.status === 'cancelled') {
        const message = status.message || `Provider task ${status.status}`;
        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: {
            status:
              status.status === 'cancelled'
                ? MotionGenerationStatus.CANCELLED
                : MotionGenerationStatus.FAILED,
            errorCode: 'PROVIDER_TASK_FAILED',
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

        return { status: status.status };
      }

      if (data.pollAttempt >= data.maxPollAttempts) {
        const message = `Kling task polling timed out after ${data.maxPollAttempts} attempts`;
        await prisma.motionGeneration.update({
          where: { id: motion.id },
          data: {
            status: MotionGenerationStatus.FAILED,
            errorCode: 'POLL_TIMEOUT',
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
        return { status: 'timeout' };
      }

      // Still submitted/processing — schedule next bounded poll.
      await enqueueMotionPollJob(
        {
          ...data,
          pollAttempt: data.pollAttempt + 1,
        },
        data.pollIntervalSeconds * 1000,
      );

      return { status: status.status, nextPollAttempt: data.pollAttempt + 1 };
    } catch (error) {
      const message = (error as Error).message || 'Video status polling failed';
      logger.error(
        {
          err: error,
          motionGenerationId: data.motionGenerationId,
          pollAttempt: data.pollAttempt,
        },
        message,
      );

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
      if (!isFinalAttempt) {
        throw error;
      }

      // Bounded retry of the poll job itself failed — schedule another poll if budget remains.
      if (data.pollAttempt < data.maxPollAttempts) {
        await enqueueMotionPollJob(
          {
            ...data,
            pollAttempt: data.pollAttempt + 1,
          },
          data.pollIntervalSeconds * 1000,
        );
        return { status: 'retry_scheduled', error: message };
      }

      await prisma.motionGeneration.update({
        where: { id: data.motionGenerationId },
        data: {
          status: MotionGenerationStatus.FAILED,
          errorCode: 'POLL_FAILED',
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

      throw error;
    }
  };
}
