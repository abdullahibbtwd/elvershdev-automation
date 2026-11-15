import type { Job, Processor } from 'bullmq';
import { JobStatus, ProjectStatus } from '@prisma/client';
import type { GenerationQueuePayload } from '@ai-video/shared';
import { getPrisma } from '../lib/prisma';
import type { Logger } from '../lib/logger';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createStubProcessor(queueLabel: string, logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;

    logger.info(
      { queue: queueLabel, bullJobId: job.id, generationJobId, attempt: job.attemptsMade + 1 },
      'Placeholder job started',
    );

    if (generationJobId) {
      await prisma.generationJob.updateMany({
        where: {
          id: generationJobId,
          status: { not: JobStatus.CANCELLED },
        },
        data: {
          status: JobStatus.PROCESSING,
          progress: 5,
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    try {
      for (const progress of [25, 50, 75]) {
        await sleep(150);
        await job.updateProgress(progress);
        if (generationJobId) {
          await prisma.generationJob.updateMany({
            where: {
              id: generationJobId,
              status: { notIn: [JobStatus.CANCELLED, JobStatus.FAILED] },
            },
            data: { progress },
          });
        }
      }

      if (data.simulateFailure) {
        throw new Error(`Simulated failure in ${queueLabel}`);
      }

      await job.updateProgress(100);

      const result = {
        status: 'completed',
        queue: queueLabel,
        processedAt: new Date().toISOString(),
        placeholder: true,
      };

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: {
            id: generationJobId,
            status: { not: JobStatus.CANCELLED },
          },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            result,
            actualCost: 0,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        if (data.videoProjectId) {
          await prisma.videoProject.updateMany({
            where: { id: data.videoProjectId, userId: data.userId },
            data: { status: ProjectStatus.READY },
          });
        }
      }

      logger.info({ queue: queueLabel, generationJobId }, 'Placeholder job completed');
      return result;
    } catch (error) {
      const message = (error as Error).message;
      const maxAttempts = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: {
            id: generationJobId,
            status: { not: JobStatus.CANCELLED },
          },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            progress: isFinalAttempt ? 100 : Math.min(90, Number(job.progress) || 0),
            errorMessage: message,
            attempts: job.attemptsMade + 1,
            ...(isFinalAttempt ? { completedAt: new Date() } : {}),
          },
        });

        if (isFinalAttempt && data.videoProjectId) {
          await prisma.videoProject.updateMany({
            where: { id: data.videoProjectId, userId: data.userId },
            data: { status: ProjectStatus.FAILED },
          });
        }
      }

      logger.error({ queue: queueLabel, generationJobId, err: message }, 'Placeholder job failed');
      throw error;
    }
  };
}
