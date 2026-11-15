import { Queue } from 'bullmq';
import { QUEUE_NAMES, type SocialPublishStatusQueuePayload } from '@ai-video/shared';
import { createRedisConnection } from '../redis';

export async function enqueueSocialPublishStatusJob(
  data: SocialPublishStatusQueuePayload,
  delayMs: number,
): Promise<{ queueJobId: string | undefined }> {
  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.SOCIAL_PUBLISH_STATUS, { connection });
  try {
    const jobId = `social-status-${data.publishRecordId}-${data.pollAttempt}`;
    const bullJob = await queue.add('status', data, {
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
