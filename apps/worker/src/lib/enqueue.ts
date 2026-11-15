import { Queue } from 'bullmq';
import type {
  AudioPipelineQueuePayload,
  GenerationJobTypeKey,
  GenerationQueuePayload,
  MotionDownloadQueuePayload,
  MotionPollQueuePayload,
  VideoRenderQueuePayload,
} from '@ai-video/shared';
import { QUEUE_NAMES } from '@ai-video/shared';
import { createRedisConnection } from './redis';

export async function enqueueGenerationJob(
  queueName: string,
  jobType: GenerationJobTypeKey | string,
  data: GenerationQueuePayload,
  options?: { attempts?: number; delayMs?: number; jobId?: string },
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(queueName, { connection });
  try {
    const bullJob = await queue.add(String(jobType).toLowerCase(), data, {
      jobId: options?.jobId ?? data.generationJobId,
      attempts: options?.attempts ?? 3,
      delay: options?.delayMs,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function enqueueMotionPollJob(
  data: MotionPollQueuePayload,
  delayMs: number,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.VIDEO_STATUS_POLLING, { connection });
  try {
    const jobId = `motion-poll-${data.motionGenerationId}-${data.pollAttempt}`;
    const bullJob = await queue.add('poll_video_status', data, {
      jobId,
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function enqueueMotionDownloadJob(
  data: MotionDownloadQueuePayload,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.VIDEO_DOWNLOAD, { connection });
  try {
    const jobId = `motion-download-${data.motionGenerationId}`;
    const bullJob = await queue.add('download_video', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function enqueueAudioValidationJob(
  data: AudioPipelineQueuePayload,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.AUDIO_VALIDATION, { connection });
  try {
    const jobId = `audio-validate-${data.audioGenerationId}`;
    const bullJob = await queue.add('validate_audio', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function enqueueAudioStorageJob(
  data: AudioPipelineQueuePayload,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.AUDIO_STORAGE, { connection });
  try {
    const jobId = `audio-store-${data.audioGenerationId}`;
    const bullJob = await queue.add('store_audio', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

async function enqueueVideoRenderStage(
  queueName: string,
  jobName: string,
  data: VideoRenderQueuePayload,
  jobIdSuffix: string,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(queueName, { connection });
  try {
    const jobId = `video-render-${jobIdSuffix}-${data.videoRenderId}`;
    const bullJob = await queue.add(jobName, data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return { queueJobId: bullJob.id };
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function enqueueVideoRenderPlanningJob(data: VideoRenderQueuePayload) {
  return enqueueVideoRenderStage(
    QUEUE_NAMES.VIDEO_RENDER_PLANNING,
    'plan_render',
    { ...data, stage: 'planning' },
    'plan',
  );
}

export async function enqueueVideoRenderingJob(data: VideoRenderQueuePayload) {
  return enqueueVideoRenderStage(
    QUEUE_NAMES.VIDEO_RENDERING,
    'render_video',
    { ...data, stage: 'rendering' },
    'render',
  );
}

export async function enqueueVideoRenderValidationJob(data: VideoRenderQueuePayload) {
  return enqueueVideoRenderStage(
    QUEUE_NAMES.VIDEO_RENDER_VALIDATION,
    'validate_render',
    { ...data, stage: 'validation' },
    'validate',
  );
}

export async function enqueueVideoRenderStorageJob(data: VideoRenderQueuePayload) {
  return enqueueVideoRenderStage(
    QUEUE_NAMES.VIDEO_RENDER_STORAGE,
    'store_render',
    { ...data, stage: 'storage' },
    'store',
  );
}
