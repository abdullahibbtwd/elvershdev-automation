import type { Job, Processor } from 'bullmq';
import { JobStatus, PublishStatus, VideoRenderStatus } from '@prisma/client';
import type { SocialPublishQueuePayload } from '@ai-video/shared';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { decryptCredential } from '../lib/crypto';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { enqueueSocialPublishStatusJob } from '../lib/social/enqueue';
import { publishVideoToPlatform } from '../lib/social/publish-client';
import { getMinioBucket, getPresignedDownloadUrl } from '../lib/storage';
import { S3Client } from '@aws-sdk/client-s3';

function getS3(): S3Client {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.MINIO_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    },
  });
}

async function downloadToTempFile(storageKey: string, suffix = '.mp4'): Promise<{
  path: string;
  size: number;
}> {
  const client = getS3();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: getMinioBucket(),
      Key: storageKey,
    }),
  );
  if (!response.Body) {
    throw new Error(`Empty object body for ${storageKey}`);
  }

  const path = join(tmpdir(), `social-publish-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  const body = response.Body as Readable;
  await pipeline(body, createWriteStream(path));
  const stat = await fs.stat(path);
  return { path, size: stat.size };
}

export function createSocialPublishingProcessor(logger: Logger): Processor {
  return async (job: Job<SocialPublishQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;

    logger.info(
      {
        bullJobId: job.id,
        publishRecordId: data.publishRecordId,
        platform: data.platform,
      },
      'Social publishing started',
    );

    const record = await prisma.publishRecord.findFirst({
      where: { id: data.publishRecordId, userId: data.userId },
      include: {
        channel: true,
        videoRender: { include: { outputMediaAsset: true } },
      },
    });

    if (!record) {
      logger.warn({ publishRecordId: data.publishRecordId }, 'Publish record missing');
      return { status: 'missing' };
    }

    if (record.status === PublishStatus.PUBLISHED) {
      return { status: 'already_published', postUrl: record.postUrl };
    }
    if (record.status === PublishStatus.CANCELLED) {
      return { status: 'cancelled' };
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
      await prisma.generationJob.updateMany({
        where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
        data: {
          status: JobStatus.PROCESSING,
          progress: 5,
          startedAt: new Date(),
          attempts: job.attemptsMade + 1,
          errorMessage: null,
        },
      });
    }

    let tempPath: string | undefined;

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in social-publishing');
      }

      await prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: PublishStatus.VALIDATING,
          uploadProgress: 5,
          errorCode: null,
          errorMessage: null,
        },
      });
      await job.updateProgress(10);

      if (!record.channel || !record.channel.isActive) {
        throw new Error('Channel is missing or inactive');
      }
      if (
        !record.videoRender ||
        record.videoRender.status !== VideoRenderStatus.COMPLETED ||
        !record.videoRender.outputMediaAsset
      ) {
        throw new Error('Completed video render with output media is required');
      }

      const asset = record.videoRender.outputMediaAsset;
      const mimeType = asset.mimeType ?? 'video/mp4';

      await prisma.publishRecord.update({
        where: { id: record.id },
        data: { status: PublishStatus.UPLOADING, uploadProgress: 15 },
      });
      await job.updateProgress(20);

      const downloaded = await downloadToTempFile(
        asset.storageKey,
        mimeType.includes('webm') ? '.webm' : '.mp4',
      );
      tempPath = downloaded.path;

      const accessToken = decryptCredential(record.channel.accessTokenEncrypted);
      const presignTtl = Number.parseInt(process.env.SOCIAL_PRESIGN_TTL_SECONDS ?? '3600', 10);
      let mediaUrl: string | undefined;
      try {
        mediaUrl = await getPresignedDownloadUrl(asset.storageKey, presignTtl);
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          'Failed to create media URL; continuing with local upload only',
        );
      }

      await job.updateProgress(40);
      await prisma.publishRecord.update({
        where: { id: record.id },
        data: { status: PublishStatus.PUBLISHING, uploadProgress: 40, submittedAt: new Date() },
      });

      const result = await publishVideoToPlatform(
        data.platform,
        {
          accessToken,
          platformAccountId: record.channel.platformAccountId,
          localFilePath: tempPath,
          mediaUrl,
          mimeType,
          fileSizeBytes: Number(asset.fileSize ?? downloaded.size),
          title: record.title ?? undefined,
          caption: record.caption ?? undefined,
          description: record.description ?? undefined,
          hashtags: record.hashtags,
          platformSettings: (record.platformSettings as Record<string, unknown>) ?? {},
        },
        { useMock: data.useMockSocial },
      );

      if (result.phase === 'failed') {
        throw Object.assign(new Error(result.errorMessage || 'Publish failed'), {
          code: result.errorCode,
        });
      }

      await prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: result.requiresStatusPoll ? PublishStatus.PROCESSING : PublishStatus.PUBLISHED,
          providerUploadId: result.providerUploadId ?? record.providerUploadId,
          providerPublishId: result.providerPublishId ?? record.providerPublishId,
          providerPostId: result.providerPostId ?? record.providerPostId,
          externalPostId: result.providerPostId ?? record.externalPostId,
          postUrl: result.postUrl ?? record.postUrl,
          uploadProgress: result.uploadProgress ?? 90,
          ...(result.requiresStatusPoll
            ? {}
            : { publishedAt: new Date(), uploadProgress: 100 }),
        },
      });

      if (result.requiresStatusPoll) {
        await enqueueSocialPublishStatusJob(
          {
            generationJobId: data.generationJobId,
            publishRecordId: record.id,
            userId: data.userId,
            videoRenderId: data.videoRenderId,
            channelId: data.channelId,
            platform: data.platform,
            pollAttempt: 0,
            maxPollAttempts: 60,
            pollIntervalSeconds: Math.max(2, Math.round((result.pollAfterMs ?? 5000) / 1000)),
            useMockSocial: data.useMockSocial,
          },
          result.pollAfterMs ?? 5000,
        );

        if (data.generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
            data: {
              status: JobStatus.PROCESSING,
              progress: 70,
              result: { phase: result.phase, awaitingStatus: true },
            },
          });
        }

        await job.updateProgress(70);
        return { status: 'submitted', requiresStatusPoll: true, result };
      }

      if (data.generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            completedAt: new Date(),
            result: { phase: 'published', postUrl: result.postUrl },
          },
        });
      }

      await job.updateProgress(100);
      logger.info({ publishRecordId: record.id }, 'Social publishing completed');
      return { status: 'published', postUrl: result.postUrl };
    } catch (error) {
      const message = (error as Error).message;
      const code = (error as { code?: string }).code ?? 'SOCIAL_PUBLISH_FAILED';
      const maxAttempts = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      await prisma.publishRecord.updateMany({
        where: {
          id: record.id,
          status: { notIn: [PublishStatus.PUBLISHED, PublishStatus.CANCELLED] },
        },
        data: {
          status: isFinalAttempt ? PublishStatus.FAILED : PublishStatus.UPLOADING,
          errorCode: code,
          errorMessage: message,
        },
      });

      if (data.generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: data.generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            errorMessage: message,
            attempts: job.attemptsMade + 1,
            ...(isFinalAttempt ? { completedAt: new Date(), progress: 100 } : {}),
          },
        });
      }

      logger.error({ publishRecordId: record.id, err: message }, 'Social publishing failed');
      throw error;
    } finally {
      if (tempPath) {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    }
  };
}
