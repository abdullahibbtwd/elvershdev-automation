import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job, Processor } from 'bullmq';
import { Prisma, VideoRenderStatus } from '@prisma/client';
import type { VideoRenderQueuePayload } from '@ai-video/shared';
import { FfmpegService } from '../lib/ffmpeg';
import { enqueueVideoRenderStorageJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  isRenderCancelled,
  markRenderFailed,
  updateRenderProgress,
} from '../lib/render-helpers';
import { downloadObject } from '../lib/storage';

type TempArtifacts = {
  tempFinalKey?: string;
  tempSrtKey?: string | null;
  tempAssKey?: string | null;
};

export function createVideoRenderValidationProcessor(logger: Logger): Processor {
  return async (job: Job<VideoRenderQueuePayload>) => {
    const prisma = getPrisma();
    const ffmpeg = new FfmpegService();
    const { videoRenderId, generationJobId } = job.data;
    let workDir: string | null = null;

    logger.info(
      { bullJobId: job.id, videoRenderId, generationJobId, attempt: job.attemptsMade + 1 },
      'Video render validation started',
    );

    const render = await prisma.videoRender.findUnique({ where: { id: videoRenderId } });
    if (!render) throw new Error(`VideoRender ${videoRenderId} not found`);
    if (await isRenderCancelled(prisma, videoRenderId)) return { status: 'cancelled' };

    try {
      if (job.data.simulateFailure) {
        throw new Error('Simulated failure in video-render-validation');
      }

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.VALIDATING,
        progress: 90,
      });

      const settings = (render.renderSettings ?? {}) as Record<string, unknown>;
      const temp = (settings._temp ?? {}) as TempArtifacts;
      if (!temp.tempFinalKey) {
        throw new Error('Missing temporary final render object for validation');
      }

      workDir = await ffmpeg.createTempDir(`validate-${videoRenderId}-`);
      await mkdir(workDir, { recursive: true });
      const localFinal = join(workDir, 'final.mp4');
      const buffer = await downloadObject(temp.tempFinalKey);
      await writeFile(localFinal, buffer);

      const probe = await ffmpeg.validateOutput(localFinal);

      const maxBytes = parseInt(process.env.VIDEO_RENDER_MAX_OUTPUT_BYTES ?? String(500 * 1024 * 1024), 10);
      if (probe.fileSize && probe.fileSize > maxBytes) {
        throw new Error(`Rendered output exceeds max size (${probe.fileSize} > ${maxBytes})`);
      }

      await prisma.videoRender.update({
        where: { id: videoRenderId },
        data: {
          duration: probe.durationSeconds,
          fileSize: probe.fileSize ? BigInt(probe.fileSize) : null,
          progress: 93,
          renderSettings: {
            ...settings,
            _validation: {
              width: probe.width,
              height: probe.height,
              frameRate: probe.frameRate,
              videoCodec: probe.videoCodec,
              audioCodec: probe.audioCodec,
              durationSeconds: probe.durationSeconds,
              fileSize: probe.fileSize,
            },
          } as Prisma.InputJsonValue,
        },
      });

      const { queueJobId } = await enqueueVideoRenderStorageJob({
        generationJobId: generationJobId ?? render.generationJobId ?? '',
        videoRenderId,
        userId: render.userId,
        storyId: render.storyId,
        stage: 'storage',
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            queueName: 'video-render-storage',
            queueJobId: queueJobId ?? undefined,
            progress: 93,
          },
        });
      }

      await ffmpeg.cleanupTemporaryFiles([workDir]);
      logger.info({ videoRenderId, duration: probe.durationSeconds }, 'Video render validated');
      return { status: 'validated', probe };
    } catch (error) {
      if (workDir) await ffmpeg.cleanupTemporaryFiles([workDir]);
      const message = (error as Error).message || 'Render validation failed';
      logger.error({ err: error, videoRenderId }, 'Video render validation failed');
      await markRenderFailed(prisma, {
        videoRenderId,
        generationJobId,
        errorCode: 'VALIDATION_FAILED',
        errorMessage: message,
      });
      throw error;
    }
  };
}
