import type { Job, Processor } from 'bullmq';
import {
  JobStatus,
  Prisma,
  VideoRenderSceneStatus,
  VideoRenderStatus,
} from '@prisma/client';
import type { GenerationQueuePayload, VideoRenderQueuePayload } from '@ai-video/shared';
import { enqueueVideoRenderingJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  buildTimelineFromStory,
  isRenderCancelled,
  markRenderFailed,
  updateRenderProgress,
} from '../lib/render-helpers';

function extractPayload(data: GenerationQueuePayload | VideoRenderQueuePayload): VideoRenderQueuePayload {
  if ('videoRenderId' in data && data.videoRenderId) {
    return data as VideoRenderQueuePayload;
  }
  const nested = (data as GenerationQueuePayload).payload as Partial<VideoRenderQueuePayload> | undefined;
  return {
    generationJobId: data.generationJobId,
    videoRenderId: String(nested?.videoRenderId ?? ''),
    userId: data.userId,
    storyId: String(data.storyId ?? nested?.storyId ?? ''),
    simulateFailure: Boolean((data as GenerationQueuePayload).simulateFailure ?? nested?.simulateFailure),
    forceRerender: nested?.forceRerender,
    stage: 'planning',
  };
}

export function createVideoRenderPlanningProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload | VideoRenderQueuePayload>) => {
    const prisma = getPrisma();
    const data = extractPayload(job.data);
    const { videoRenderId, generationJobId } = data;

    logger.info(
      { bullJobId: job.id, videoRenderId, generationJobId, attempt: job.attemptsMade + 1 },
      'Video render planning started',
    );

    if (!videoRenderId) {
      throw new Error('videoRenderId is required');
    }

    const render = await prisma.videoRender.findUnique({ where: { id: videoRenderId } });
    if (!render) throw new Error(`VideoRender ${videoRenderId} not found`);

    if (await isRenderCancelled(prisma, videoRenderId)) {
      return { status: 'cancelled' };
    }

    if (render.status === VideoRenderStatus.COMPLETED && !data.forceRerender) {
      return { status: 'already_completed' };
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in video-render-planning');
      }

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.PLANNING,
        progress: 5,
        startedAt: render.startedAt ?? new Date(),
        errorCode: null,
        errorMessage: null,
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.PROCESSING,
            startedAt: new Date(),
            progress: 5,
            attempts: { increment: 1 },
          },
        });
      }

      const timeline = await buildTimelineFromStory(prisma, render.storyId, render.renderSettings);

      await prisma.videoRenderScene.deleteMany({ where: { videoRenderId } });
      await prisma.videoRenderScene.createMany({
        data: timeline.scenes.map((scene) => ({
          videoRenderId,
          sceneId: scene.sceneId,
          sequence: scene.sequence,
          startTime: scene.startTime,
          endTime: scene.endTime,
          duration: scene.duration,
          selectedMotionGenerationId: scene.selectedMotionGenerationId,
          selectedVisualId: scene.selectedVisualId,
          selectedAudioGenerationId: scene.selectedAudioGenerationId,
          transitionIn: scene.transitionIn,
          transitionOut: scene.transitionOut,
          status: VideoRenderSceneStatus.READY,
        })),
      });

      const continued = await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.PREPARING_ASSETS,
        progress: 12,
        timeline: timeline as unknown as Prisma.InputJsonValue,
        totalSceneCount: timeline.sceneCount,
        completedSceneCount: 0,
      });
      if (!continued) return { status: 'cancelled' };

      const { queueJobId } = await enqueueVideoRenderingJob({
        generationJobId,
        videoRenderId,
        userId: render.userId,
        storyId: render.storyId,
        simulateFailure: data.simulateFailure,
        stage: 'rendering',
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            queueName: 'video-rendering',
            queueJobId: queueJobId ?? undefined,
            progress: 12,
          },
        });
      }

      logger.info(
        { videoRenderId, scenes: timeline.sceneCount, duration: timeline.totalDurationSeconds },
        'Video render planning completed',
      );
      return { status: 'planned', sceneCount: timeline.sceneCount };
    } catch (error) {
      const message = (error as Error).message || 'Render planning failed';
      logger.error({ err: error, videoRenderId }, 'Video render planning failed');
      await markRenderFailed(prisma, {
        videoRenderId,
        generationJobId,
        errorCode: 'PLANNING_FAILED',
        errorMessage: message,
      });
      throw error;
    }
  };
}
