import type { Job, Processor } from 'bullmq';
import type { SocialMediaUploadQueuePayload } from '@ai-video/shared';
import type { Logger } from '../lib/logger';
import { createSocialPublishingProcessor } from './social-publishing.processor';

/**
 * Dedicated upload queue entrypoint. Reuses the main publishing processor so
 * retries can target upload-stage jobs without re-submitting ambiguous publishes.
 */
export function createSocialMediaUploadProcessor(logger: Logger): Processor {
  const publish = createSocialPublishingProcessor(logger);
  return async (job: Job<SocialMediaUploadQueuePayload>) => {
    logger.info(
      { bullJobId: job.id, publishRecordId: job.data.publishRecordId },
      'Social media upload stage started',
    );
    return publish(job);
  };
}
