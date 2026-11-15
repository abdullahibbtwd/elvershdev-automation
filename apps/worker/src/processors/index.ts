import type { ConnectionOptions } from 'bullmq';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '@ai-video/shared';
import type { Logger } from '../lib/logger';
import { createAudioStorageProcessor } from './audio-storage.processor';
import { createAudioValidationProcessor } from './audio-validation.processor';
import { createCharacterReferenceProcessor } from './character-reference.processor';
import { createImageGenerationProcessor } from './image-generation.processor';
import { createMotionAnalysisProcessor } from './motion-analysis.processor';
import { createNarrationPlanningProcessor } from './narration-planning.processor';
import { createScenePlanningProcessor } from './scene-planning.processor';
import { createSpeechGenerationProcessor } from './speech-generation.processor';
import { createStoryGenerationProcessor } from './story-generation.processor';
import { createStubProcessor } from './stub.processor';
import { createVideoDownloadProcessor } from './video-download.processor';
import { createVideoGenerationProcessor } from './video-generation.processor';
import { createVideoRenderPlanningProcessor } from './video-render-planning.processor';
import { createVideoRenderStorageProcessor } from './video-render-storage.processor';
import { createVideoRenderValidationProcessor } from './video-render-validation.processor';
import { createVideoRenderingProcessor } from './video-rendering.processor';
import { createVideoStatusPollingProcessor } from './video-status-polling.processor';
import { createVisualAnalysisProcessor } from './visual-analysis.processor';
import { createSocialMediaUploadProcessor } from './social-media-upload.processor';
import { createSocialPublishStatusProcessor } from './social-publish-status.processor';
import { createSocialPublishingProcessor } from './social-publishing.processor';
import { createSocialTokenMaintenanceProcessor } from './social-token-maintenance.processor';

export function createWorkers(connection: ConnectionOptions, logger: Logger): Worker[] {
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
  const klingConcurrency = parseInt(
    process.env.KLING_MAX_CONCURRENCY ?? String(concurrency),
    10,
  );
  const ttsConcurrency = parseInt(
    process.env.GEMINI_TTS_MAX_CONCURRENCY ?? String(concurrency),
    10,
  );
  const renderConcurrency = parseInt(
    process.env.VIDEO_RENDER_MAX_CONCURRENCY ?? '1',
    10,
  );
  const imageConcurrency = parseInt(
    process.env.IMAGE_GENERATION_MAX_CONCURRENCY ?? String(concurrency),
    10,
  );
  const publishConcurrency = parseInt(
    process.env.PUBLISHING_MAX_CONCURRENCY ?? String(concurrency),
    10,
  );
  const lockDuration = parseInt(process.env.WORKER_LOCK_DURATION_MS ?? '120000', 10);
  const stalledInterval = parseInt(process.env.WORKER_STALLED_INTERVAL_MS ?? '60000', 10);
  const maxStalledCount = parseInt(process.env.WORKER_MAX_STALLED_COUNT ?? '2', 10);

  const definitions: Array<{
    name: string;
    processor: ReturnType<typeof createStubProcessor>;
    concurrency?: number;
  }> = [
    {
      name: QUEUE_NAMES.STORY_GENERATION,
      processor: createStoryGenerationProcessor(logger),
    },
    {
      name: QUEUE_NAMES.SCENE_PLANNING,
      processor: createScenePlanningProcessor(logger),
    },
    {
      name: QUEUE_NAMES.VISUAL_ANALYSIS,
      processor: createVisualAnalysisProcessor(logger),
    },
    {
      name: QUEUE_NAMES.CHARACTER_REFERENCE,
      processor: createCharacterReferenceProcessor(logger),
    },
    {
      name: QUEUE_NAMES.IMAGE_GENERATION,
      processor: createImageGenerationProcessor(logger),
      concurrency:
        Number.isFinite(imageConcurrency) && imageConcurrency > 0 ? imageConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.MOTION_ANALYSIS,
      processor: createMotionAnalysisProcessor(logger),
    },
    {
      name: QUEUE_NAMES.VIDEO_GENERATION,
      processor: createVideoGenerationProcessor(logger),
      concurrency: Number.isFinite(klingConcurrency) && klingConcurrency > 0 ? klingConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.VIDEO_STATUS_POLLING,
      processor: createVideoStatusPollingProcessor(logger),
      concurrency: Number.isFinite(klingConcurrency) && klingConcurrency > 0 ? klingConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.VIDEO_DOWNLOAD,
      processor: createVideoDownloadProcessor(logger),
      concurrency: Number.isFinite(klingConcurrency) && klingConcurrency > 0 ? klingConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.NARRATION_PLANNING,
      processor: createNarrationPlanningProcessor(logger),
    },
    {
      name: QUEUE_NAMES.SPEECH_GENERATION,
      processor: createSpeechGenerationProcessor(logger),
      concurrency: Number.isFinite(ttsConcurrency) && ttsConcurrency > 0 ? ttsConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.AUDIO_VALIDATION,
      processor: createAudioValidationProcessor(logger),
      concurrency: Number.isFinite(ttsConcurrency) && ttsConcurrency > 0 ? ttsConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.AUDIO_STORAGE,
      processor: createAudioStorageProcessor(logger),
      concurrency: Number.isFinite(ttsConcurrency) && ttsConcurrency > 0 ? ttsConcurrency : concurrency,
    },
    {
      name: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
      processor: createVideoRenderPlanningProcessor(logger),
      concurrency: Number.isFinite(renderConcurrency) && renderConcurrency > 0 ? renderConcurrency : 1,
    },
    {
      name: QUEUE_NAMES.VIDEO_RENDERING,
      processor: createVideoRenderingProcessor(logger),
      concurrency: Number.isFinite(renderConcurrency) && renderConcurrency > 0 ? renderConcurrency : 1,
    },
    {
      name: QUEUE_NAMES.VIDEO_RENDER_VALIDATION,
      processor: createVideoRenderValidationProcessor(logger),
      concurrency: Number.isFinite(renderConcurrency) && renderConcurrency > 0 ? renderConcurrency : 1,
    },
    {
      name: QUEUE_NAMES.VIDEO_RENDER_STORAGE,
      processor: createVideoRenderStorageProcessor(logger),
      concurrency: Number.isFinite(renderConcurrency) && renderConcurrency > 0 ? renderConcurrency : 1,
    },
    {
      name: QUEUE_NAMES.SOCIAL_PUBLISHING,
      processor: createSocialPublishingProcessor(logger),
      concurrency:
        Number.isFinite(publishConcurrency) && publishConcurrency > 0
          ? publishConcurrency
          : concurrency,
    },
    {
      name: QUEUE_NAMES.SOCIAL_MEDIA_UPLOAD,
      processor: createSocialMediaUploadProcessor(logger),
      concurrency:
        Number.isFinite(publishConcurrency) && publishConcurrency > 0
          ? publishConcurrency
          : concurrency,
    },
    {
      name: QUEUE_NAMES.SOCIAL_PUBLISH_STATUS,
      processor: createSocialPublishStatusProcessor(logger),
      concurrency:
        Number.isFinite(publishConcurrency) && publishConcurrency > 0
          ? publishConcurrency
          : concurrency,
    },
    {
      name: QUEUE_NAMES.SOCIAL_TOKEN_MAINTENANCE,
      processor: createSocialTokenMaintenanceProcessor(logger),
    },
    // Automation and analytics queues are API-hosted because their processors use Nest DI.
  ];

  return definitions.map(
    ({ name, processor, concurrency: workerConcurrency }) =>
      new Worker(name, processor, {
        connection,
        concurrency: workerConcurrency ?? concurrency,
        lockDuration: Number.isFinite(lockDuration) ? lockDuration : 120_000,
        stalledInterval: Number.isFinite(stalledInterval) ? stalledInterval : 60_000,
        maxStalledCount: Number.isFinite(maxStalledCount) ? maxStalledCount : 2,
      }),
  );
}
