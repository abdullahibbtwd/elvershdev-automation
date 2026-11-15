import type { Job, Processor } from 'bullmq';
import { JobStatus, MediaType, Prisma, VideoRenderStatus } from '@prisma/client';
import type { VideoRenderQueuePayload } from '@ai-video/shared';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  finalRenderKey,
  isRenderCancelled,
  markRenderFailed,
  updateRenderProgress,
} from '../lib/render-helpers';
import { deleteObject, downloadObject, uploadObject } from '../lib/storage';

type TempArtifacts = {
  tempFinalKey?: string;
  tempSrtKey?: string | null;
  tempAssKey?: string | null;
};

export function createVideoRenderStorageProcessor(logger: Logger): Processor {
  return async (job: Job<VideoRenderQueuePayload>) => {
    const prisma = getPrisma();
    const { videoRenderId, generationJobId } = job.data;

    logger.info(
      { bullJobId: job.id, videoRenderId, generationJobId, attempt: job.attemptsMade + 1 },
      'Video render storage started',
    );

    const render = await prisma.videoRender.findUnique({ where: { id: videoRenderId } });
    if (!render) throw new Error(`VideoRender ${videoRenderId} not found`);
    if (await isRenderCancelled(prisma, videoRenderId)) return { status: 'cancelled' };

    if (render.status === VideoRenderStatus.COMPLETED && render.outputMediaAssetId) {
      return { status: 'already_completed' };
    }

    try {
      if (job.data.simulateFailure) {
        throw new Error('Simulated failure in video-render-storage');
      }

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.UPLOADING,
        progress: 96,
      });

      const settings = (render.renderSettings ?? {}) as Record<string, unknown>;
      const temp = (settings._temp ?? {}) as TempArtifacts;
      if (!temp.tempFinalKey) {
        throw new Error('Missing temporary final render object for storage');
      }

      const finalKey = finalRenderKey({
        userId: render.userId,
        storyId: render.storyId,
        renderId: videoRenderId,
        fileName: 'final.mp4',
      });
      const finalBuffer = await downloadObject(temp.tempFinalKey);
      await uploadObject(finalKey, finalBuffer, 'video/mp4');

      const validation = (settings._validation ?? {}) as {
        width?: number;
        height?: number;
        frameRate?: number;
        videoCodec?: string;
        audioCodec?: string;
        durationSeconds?: number;
        fileSize?: number;
      };

      const outputAsset = await prisma.mediaAsset.create({
        data: {
          userId: render.userId,
          type: MediaType.VIDEO,
          storageKey: finalKey,
          originalName: `story-${render.storyId}-render-${videoRenderId}.mp4`,
          mimeType: 'video/mp4',
          fileSize: BigInt(validation.fileSize ?? finalBuffer.length),
          metadata: {
            width: validation.width ?? render.width,
            height: validation.height ?? render.height,
            frameRate: validation.frameRate ?? render.frameRate,
            videoCodec: validation.videoCodec ?? render.videoCodec,
            audioCodec: validation.audioCodec ?? render.audioCodec,
            durationSeconds: validation.durationSeconds ?? render.duration,
            renderId: videoRenderId,
          } as Prisma.InputJsonValue,
        },
      });

      let subtitleAssetId: string | null = null;
      if (temp.tempSrtKey) {
        const srtKey = finalRenderKey({
          userId: render.userId,
          storyId: render.storyId,
          renderId: videoRenderId,
          fileName: 'subtitles.srt',
        });
        const srtBuffer = await downloadObject(temp.tempSrtKey);
        await uploadObject(srtKey, srtBuffer, 'application/x-subrip');
        const subtitleAsset = await prisma.mediaAsset.create({
          data: {
            userId: render.userId,
            type: MediaType.SUBTITLE,
            storageKey: srtKey,
            originalName: `story-${render.storyId}-render-${videoRenderId}.srt`,
            mimeType: 'application/x-subrip',
            fileSize: BigInt(srtBuffer.length),
            metadata: { renderId: videoRenderId, format: 'srt' } as Prisma.InputJsonValue,
          },
        });
        subtitleAssetId = subtitleAsset.id;

        if (temp.tempAssKey) {
          const assKey = finalRenderKey({
            userId: render.userId,
            storyId: render.storyId,
            renderId: videoRenderId,
            fileName: 'subtitles.ass',
          });
          const assBuffer = await downloadObject(temp.tempAssKey);
          await uploadObject(assKey, assBuffer, 'text/x-ass');
        }
      }

      const metadataKey = finalRenderKey({
        userId: render.userId,
        storyId: render.storyId,
        renderId: videoRenderId,
        fileName: 'render-metadata.json',
      });
      await uploadObject(
        metadataKey,
        Buffer.from(
          JSON.stringify(
            {
              renderId: videoRenderId,
              storyId: render.storyId,
              duration: validation.durationSeconds ?? render.duration,
              width: validation.width ?? render.width,
              height: validation.height ?? render.height,
              videoCodec: validation.videoCodec ?? render.videoCodec,
              audioCodec: validation.audioCodec ?? render.audioCodec,
              fileSize: validation.fileSize ?? finalBuffer.length,
            },
            null,
            2,
          ),
          'utf8',
        ),
        'application/json',
      );

      const startedAt = render.startedAt?.getTime() ?? Date.now();
      const processingTimeMs = Date.now() - startedAt;

      const cleanedSettings = { ...settings };
      delete cleanedSettings._temp;

      await prisma.videoRender.update({
        where: { id: videoRenderId },
        data: {
          status: VideoRenderStatus.COMPLETED,
          progress: 100,
          outputMediaAssetId: outputAsset.id,
          subtitleMediaAssetId: subtitleAssetId,
          duration: validation.durationSeconds ?? render.duration,
          fileSize: BigInt(validation.fileSize ?? finalBuffer.length),
          processingTimeMs,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          renderSettings: cleanedSettings as Prisma.InputJsonValue,
        },
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            completedAt: new Date(),
            result: {
              outputMediaAssetId: outputAsset.id,
              subtitleMediaAssetId: subtitleAssetId,
              duration: validation.durationSeconds ?? render.duration,
              fileSize: validation.fileSize ?? finalBuffer.length,
              processingTimeMs,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // Cleanup temporary objects (best-effort)
      for (const key of [temp.tempFinalKey, temp.tempSrtKey, temp.tempAssKey]) {
        if (!key) continue;
        try {
          await deleteObject(key);
        } catch {
          // ignore
        }
      }

      // Cleanup temp scene segments
      const scenes = await prisma.videoRenderScene.findMany({
        where: { videoRenderId, segmentStorageKey: { not: null } },
      });
      for (const scene of scenes) {
        if (!scene.segmentStorageKey) continue;
        try {
          await deleteObject(scene.segmentStorageKey);
        } catch {
          // ignore
        }
      }
      await prisma.videoRenderScene.updateMany({
        where: { videoRenderId },
        data: { segmentStorageKey: null },
      });

      logger.info(
        {
          videoRenderId,
          outputMediaAssetId: outputAsset.id,
          fileSize: validation.fileSize ?? finalBuffer.length,
          processingTimeMs,
        },
        'Video render storage completed',
      );
      return { status: 'stored', outputMediaAssetId: outputAsset.id };
    } catch (error) {
      const message = (error as Error).message || 'Render storage failed';
      logger.error({ err: error, videoRenderId }, 'Video render storage failed');
      await markRenderFailed(prisma, {
        videoRenderId,
        generationJobId,
        errorCode: 'STORAGE_FAILED',
        errorMessage: message,
      });
      throw error;
    }
  };
}
