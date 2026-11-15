import type { Job, Processor } from 'bullmq';
import { JobStatus, PublishStatus } from '@prisma/client';
import type { SocialPublishStatusQueuePayload } from '@ai-video/shared';
import { decryptCredential } from '../lib/crypto';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { enqueueSocialPublishStatusJob } from '../lib/social/enqueue';
import { getPlatformPublishStatus } from '../lib/social/publish-client';

export function createSocialPublishStatusProcessor(logger: Logger): Processor {
  return async (job: Job<SocialPublishStatusQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;

    logger.info(
      {
        bullJobId: job.id,
        publishRecordId: data.publishRecordId,
        pollAttempt: data.pollAttempt,
      },
      'Social publish status poll started',
    );

    const record = await prisma.publishRecord.findFirst({
      where: { id: data.publishRecordId, userId: data.userId },
      include: { channel: true },
    });

    if (!record || !record.channel) {
      return { status: 'missing' };
    }

    if (
      record.status === PublishStatus.PUBLISHED ||
      record.status === PublishStatus.CANCELLED ||
      record.status === PublishStatus.FAILED
    ) {
      return { status: record.status.toLowerCase() };
    }

    if (data.generationJobId) {
      const generationJob = await prisma.generationJob.findUnique({
        where: { id: data.generationJobId },
        select: { status: true },
      });
      if (generationJob?.status === JobStatus.CANCELLED) {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: { status: PublishStatus.CANCELLED, errorMessage: 'Cancelled by user' },
        });
        return { status: 'cancelled' };
      }
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in social-publish-status');
      }

      const accessToken = decryptCredential(record.channel.accessTokenEncrypted);
      const status = await getPlatformPublishStatus(
        data.platform,
        {
          accessToken,
          platformAccountId: record.channel.platformAccountId,
          providerUploadId: record.providerUploadId,
          providerPublishId: record.providerPublishId,
          providerPostId: record.providerPostId,
        },
        { useMock: data.useMockSocial },
      );

      if (status.phase === 'failed') {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.FAILED,
            errorCode: status.errorCode ?? 'PROVIDER_FAILED',
            errorMessage: status.errorMessage ?? 'Provider reported failure',
          },
        });
        if (data.generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: data.generationJobId },
            data: {
              status: JobStatus.FAILED,
              progress: 100,
              errorMessage: status.errorMessage,
              completedAt: new Date(),
            },
          });
        }
        return { status: 'failed' };
      }

      if (status.phase === 'published') {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.PUBLISHED,
            providerPostId: status.providerPostId ?? record.providerPostId,
            externalPostId: status.providerPostId ?? record.externalPostId,
            postUrl: status.postUrl ?? record.postUrl,
            uploadProgress: 100,
            publishedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
        if (data.generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: data.generationJobId },
            data: {
              status: JobStatus.COMPLETED,
              progress: 100,
              completedAt: new Date(),
              result: { phase: 'published', postUrl: status.postUrl },
            },
          });
        }
        return { status: 'published', postUrl: status.postUrl };
      }

      if (status.phase === 'action_required') {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.ACTION_REQUIRED,
            errorCode: status.errorCode ?? 'ACTION_REQUIRED',
            errorMessage: status.errorMessage ?? 'Additional action required on the platform',
          },
        });
        return { status: 'action_required' };
      }

      await prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: PublishStatus.PROCESSING,
          uploadProgress: status.uploadProgress ?? Math.min(95, 50 + data.pollAttempt),
          providerPostId: status.providerPostId ?? record.providerPostId,
          postUrl: status.postUrl ?? record.postUrl,
        },
      });

      const nextAttempt = data.pollAttempt + 1;
      if (nextAttempt >= data.maxPollAttempts) {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.ACTION_REQUIRED,
            errorCode: 'STATUS_TIMEOUT',
            errorMessage:
              'Timed out waiting for platform confirmation. Retry will check provider status without re-uploading.',
          },
        });
        if (data.generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: data.generationJobId },
            data: {
              status: JobStatus.FAILED,
              progress: 100,
              errorMessage: 'Publish status polling timed out',
              completedAt: new Date(),
            },
          });
        }
        return { status: 'timeout' };
      }

      await enqueueSocialPublishStatusJob(
        {
          ...data,
          pollAttempt: nextAttempt,
        },
        status.pollAfterMs ?? data.pollIntervalSeconds * 1000,
      );

      return { status: 'polling', pollAttempt: nextAttempt };
    } catch (error) {
      const message = (error as Error).message;
      logger.error({ publishRecordId: record.id, err: message }, 'Social status poll failed');

      if (data.pollAttempt + 1 >= data.maxPollAttempts) {
        await prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.FAILED,
            errorCode: 'STATUS_POLL_FAILED',
            errorMessage: message,
          },
        });
        throw error;
      }

      await enqueueSocialPublishStatusJob(
        { ...data, pollAttempt: data.pollAttempt + 1 },
        data.pollIntervalSeconds * 1000,
      );
      return { status: 'retry_scheduled', error: message };
    }
  };
}
