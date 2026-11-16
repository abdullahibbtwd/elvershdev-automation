export const QUEUE_NAMES = {
  STORY_GENERATION: 'story-generation',
  SCENE_PLANNING: 'scene-planning',
  VISUAL_ANALYSIS: 'visual-analysis',
  CHARACTER_REFERENCE: 'character-reference-generation',
  IMAGE_GENERATION: 'image-generation',
  MOTION_ANALYSIS: 'motion-analysis',
  VIDEO_GENERATION: 'video-generation',
  VIDEO_STATUS_POLLING: 'video-status-polling',
  VIDEO_DOWNLOAD: 'video-download',
  NARRATION_PLANNING: 'narration-planning',
  SPEECH_GENERATION: 'speech-generation',
  AUDIO_VALIDATION: 'audio-validation',
  AUDIO_STORAGE: 'audio-storage',
  /** @deprecated Prefer SPEECH_GENERATION; kept for compatibility with VOICE job type mapping */
  VOICE_GENERATION: 'speech-generation',
  VIDEO_RENDER_PLANNING: 'video-render-planning',
  VIDEO_RENDERING: 'video-rendering',
  VIDEO_RENDER_VALIDATION: 'video-render-validation',
  VIDEO_RENDER_STORAGE: 'video-render-storage',
  /** @deprecated Prefer SOCIAL_PUBLISHING; kept as alias for job-type mapping */
  VIDEO_PUBLISHING: 'social-publishing',
  SOCIAL_PUBLISHING: 'social-publishing',
  SOCIAL_MEDIA_UPLOAD: 'social-media-upload',
  SOCIAL_PUBLISH_STATUS: 'social-publish-status',
  SOCIAL_TOKEN_MAINTENANCE: 'social-token-maintenance',
  AUTOMATION_DAILY_PLANNER: 'automation-daily-planner',
  AUTOMATION_ORCHESTRATOR: 'automation-orchestrator',
  AUTOMATION_PUBLISH_SCHEDULER: 'automation-publish-scheduler',
  /** @deprecated Prefer ANALYTICS_SYNC; kept for GenerationJobType mapping */
  ANALYTICS: 'analytics-sync',
  ANALYTICS_SYNC: 'analytics-sync',
  ANALYTICS_POST_REFRESH: 'analytics-post-refresh',
  ANALYTICS_ACCOUNT_REFRESH: 'analytics-account-refresh',
  ANALYTICS_AGGREGATION: 'analytics-aggregation',
  /** Series Studio planning / orchestration (API-hosted Nest DI) */
  SERIES_STORY_PLANNING: 'series-story-planning',
  SERIES_CHARACTER_GENERATION: 'series-character-generation',
  SERIES_EPISODE_PLANNING: 'series-episode-planning',
  SERIES_EPISODE_PRODUCTION: 'series-episode-production',
  SERIES_CONTINUITY_VALIDATION: 'series-continuity-validation',
  SERIES_REPLACEMENT_PLANNING: 'series-replacement-planning',
  SERIES_PUBLISHING: 'series-publishing',
  SERIES_MAINTENANCE: 'series-maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES = [
  QUEUE_NAMES.STORY_GENERATION,
  QUEUE_NAMES.SCENE_PLANNING,
  QUEUE_NAMES.VISUAL_ANALYSIS,
  QUEUE_NAMES.CHARACTER_REFERENCE,
  QUEUE_NAMES.IMAGE_GENERATION,
  QUEUE_NAMES.MOTION_ANALYSIS,
  QUEUE_NAMES.VIDEO_GENERATION,
  QUEUE_NAMES.VIDEO_STATUS_POLLING,
  QUEUE_NAMES.VIDEO_DOWNLOAD,
  QUEUE_NAMES.NARRATION_PLANNING,
  QUEUE_NAMES.SPEECH_GENERATION,
  QUEUE_NAMES.AUDIO_VALIDATION,
  QUEUE_NAMES.AUDIO_STORAGE,
  QUEUE_NAMES.VIDEO_RENDER_PLANNING,
  QUEUE_NAMES.VIDEO_RENDERING,
  QUEUE_NAMES.VIDEO_RENDER_VALIDATION,
  QUEUE_NAMES.VIDEO_RENDER_STORAGE,
  QUEUE_NAMES.SOCIAL_PUBLISHING,
  QUEUE_NAMES.SOCIAL_MEDIA_UPLOAD,
  QUEUE_NAMES.SOCIAL_PUBLISH_STATUS,
  QUEUE_NAMES.SOCIAL_TOKEN_MAINTENANCE,
  QUEUE_NAMES.AUTOMATION_DAILY_PLANNER,
  QUEUE_NAMES.AUTOMATION_ORCHESTRATOR,
  QUEUE_NAMES.AUTOMATION_PUBLISH_SCHEDULER,
  QUEUE_NAMES.ANALYTICS_SYNC,
  QUEUE_NAMES.ANALYTICS_POST_REFRESH,
  QUEUE_NAMES.ANALYTICS_ACCOUNT_REFRESH,
  QUEUE_NAMES.ANALYTICS_AGGREGATION,
  QUEUE_NAMES.SERIES_STORY_PLANNING,
  QUEUE_NAMES.SERIES_CHARACTER_GENERATION,
  QUEUE_NAMES.SERIES_EPISODE_PLANNING,
  QUEUE_NAMES.SERIES_EPISODE_PRODUCTION,
  QUEUE_NAMES.SERIES_CONTINUITY_VALIDATION,
  QUEUE_NAMES.SERIES_REPLACEMENT_PLANNING,
  QUEUE_NAMES.SERIES_PUBLISHING,
  QUEUE_NAMES.SERIES_MAINTENANCE,
] as const;

export const JOB_TYPE_TO_QUEUE = {
  STORY: QUEUE_NAMES.STORY_GENERATION,
  SCENE_PLANNING: QUEUE_NAMES.SCENE_PLANNING,
  VISUAL_ANALYSIS: QUEUE_NAMES.VISUAL_ANALYSIS,
  CHARACTER_REFERENCE: QUEUE_NAMES.CHARACTER_REFERENCE,
  IMAGE: QUEUE_NAMES.IMAGE_GENERATION,
  MOTION_ANALYSIS: QUEUE_NAMES.MOTION_ANALYSIS,
  VIDEO: QUEUE_NAMES.VIDEO_GENERATION,
  NARRATION_PLANNING: QUEUE_NAMES.NARRATION_PLANNING,
  VOICE: QUEUE_NAMES.SPEECH_GENERATION,
  RENDER: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
  PUBLISH: QUEUE_NAMES.SOCIAL_PUBLISHING,
  ANALYTICS: QUEUE_NAMES.ANALYTICS_SYNC,
} as const;

export type GenerationJobTypeKey = keyof typeof JOB_TYPE_TO_QUEUE;

export type StoryAiJobAction = 'generate_story' | 'plan_scenes' | 'regenerate_story';

export type NarrationJobAction = 'plan_narration' | 'generate_speech';

export interface GenerationQueuePayload {
  generationJobId: string;
  userId: string;
  videoProjectId?: string | null;
  storyId?: string | null;
  storyGenerationId?: string | null;
  sceneId?: string | null;
  sceneVisualId?: string | null;
  characterProfileId?: string | null;
  motionGenerationId?: string | null;
  narrationScriptId?: string | null;
  audioGenerationId?: string | null;
  jobType: GenerationJobTypeKey;
  provider?: string | null;
  payload?: Record<string, unknown>;
  /** When true, placeholder processor simulates a failure for testing */
  simulateFailure?: boolean;
  /** Force mock Gemini / fal / Kling / TTS responses (tests / local without API key) */
  useMockAi?: boolean;
}

export interface MotionPollQueuePayload {
  generationJobId: string;
  motionGenerationId: string;
  userId: string;
  storyId: string;
  sceneId: string;
  providerTaskId: string;
  pollAttempt: number;
  maxPollAttempts: number;
  pollIntervalSeconds: number;
  /** Video generation provider id (hailuo | kling). Falls back to MotionGeneration.provider. */
  provider?: string;
  useMockAi?: boolean;
  simulateFailure?: boolean;
}

export interface MotionDownloadQueuePayload {
  generationJobId: string;
  motionGenerationId: string;
  userId: string;
  storyId: string;
  sceneId: string;
  providerTaskId: string;
  videoUrl?: string;
  /** Video generation provider id (hailuo | kling). Falls back to MotionGeneration.provider. */
  provider?: string;
  useMockAi?: boolean;
  simulateFailure?: boolean;
}

export interface AudioPipelineQueuePayload {
  generationJobId: string;
  audioGenerationId: string;
  userId: string;
  storyId: string;
  sceneId?: string | null;
  narrationScriptId: string;
  storageKey?: string;
  tempObjectKey?: string;
  useMockAi?: boolean;
  simulateFailure?: boolean;
  forceRegenerate?: boolean;
}

export interface VideoRenderQueuePayload {
  generationJobId: string;
  videoRenderId: string;
  userId: string;
  storyId: string;
  forceRerender?: boolean;
  simulateFailure?: boolean;
  /** Optional stage hint for logging / recovery */
  stage?: 'planning' | 'rendering' | 'validation' | 'storage';
}

export type SocialPlatformKey = 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE';

export interface SocialPublishQueuePayload {
  generationJobId: string;
  publishRecordId: string;
  userId: string;
  videoRenderId: string;
  channelId: string;
  platform: SocialPlatformKey;
  simulateFailure?: boolean;
  useMockSocial?: boolean;
  forceRetry?: boolean;
}

export interface SocialMediaUploadQueuePayload extends SocialPublishQueuePayload {
  stage: 'upload';
}

export interface SocialPublishStatusQueuePayload extends SocialPublishQueuePayload {
  pollAttempt: number;
  maxPollAttempts: number;
  pollIntervalSeconds: number;
}

export interface SocialTokenMaintenanceQueuePayload {
  channelId?: string;
  userId?: string;
  platform?: SocialPlatformKey;
  /** When omitted, worker scans channels nearing expiry */
  mode: 'refresh_one' | 'scan_expiring';
}

export type AutomationPlannerMode = 'daily' | 'run_now' | 'recover';

export interface AutomationDailyPlannerPayload {
  userId: string;
  mode: AutomationPlannerMode;
  /** YYYY-MM-DD in the user's configured timezone */
  planDate?: string;
  force?: boolean;
  useMockAi?: boolean;
}

export type AutomationOrchestratorAction =
  | 'advance'
  | 'start'
  | 'retry'
  | 'recover'
  | 'cancel';

export interface AutomationOrchestratorPayload {
  userId: string;
  contentScheduleId: string;
  action: AutomationOrchestratorAction;
  useMockAi?: boolean;
  force?: boolean;
}

export type AutomationPublishSchedulerMode = 'tick' | 'enqueue_one' | 'recover';

export interface AutomationPublishSchedulerPayload {
  mode: AutomationPublishSchedulerMode;
  userId?: string;
  scheduledPublicationId?: string;
  useMockSocial?: boolean;
  force?: boolean;
}

export type AnalyticsSyncMode =
  | 'full'
  | 'manual'
  | 'initial_post'
  | 'post_refresh'
  | 'account_refresh'
  | 'aggregation'
  | 'insights';

export interface AnalyticsSyncQueuePayload {
  analyticsSyncJobId: string;
  userId: string;
  mode: AnalyticsSyncMode;
  platform?: SocialPlatformKey;
  publishRecordId?: string;
  channelId?: string;
  videoRenderId?: string;
  useMockAnalytics?: boolean;
  force?: boolean;
}

export interface AnalyticsPostRefreshPayload {
  analyticsSyncJobId: string;
  userId: string;
  publishRecordId: string;
  platformPostAnalyticsId?: string;
  useMockAnalytics?: boolean;
  force?: boolean;
}

export interface AnalyticsAccountRefreshPayload {
  analyticsSyncJobId: string;
  userId: string;
  channelId: string;
  platform: SocialPlatformKey;
  useMockAnalytics?: boolean;
  force?: boolean;
}

export interface AnalyticsAggregationPayload {
  analyticsSyncJobId: string;
  userId: string;
  videoRenderId?: string;
  dateFrom?: string;
  dateTo?: string;
  force?: boolean;
}

export type SeriesPlannerMode = 'plan_movie' | 'recover' | 'manual';

export interface SeriesStoryPlanningPayload {
  userId: string;
  laneId: string;
  seriesId?: string;
  replacementPlanId?: string;
  mode: SeriesPlannerMode;
  useMockAi?: boolean;
  force?: boolean;
}

export interface SeriesCharacterGenerationPayload {
  userId: string;
  seriesId: string;
  characterId?: string;
  useMockAi?: boolean;
  force?: boolean;
}

export interface SeriesEpisodePlanningPayload {
  userId: string;
  seriesId: string;
  episodeId: string;
  useMockAi?: boolean;
  force?: boolean;
}

export type SeriesEpisodeProductionAction =
  | 'start'
  | 'advance'
  | 'retry'
  | 'recover'
  | 'cancel';

export interface SeriesEpisodeProductionPayload {
  userId: string;
  seriesId: string;
  episodeId: string;
  productionRunId?: string;
  action: SeriesEpisodeProductionAction;
  useMockAi?: boolean;
  force?: boolean;
}

export interface SeriesContinuityValidationPayload {
  userId: string;
  seriesId: string;
  episodeId: string;
  stage: 'pre_script_approval' | 'pre_visual';
  useMockAi?: boolean;
}

export interface SeriesReplacementPlanningPayload {
  userId: string;
  laneId: string;
  sourceSeriesId: string;
  replacementPlanId?: string;
  mode: 'threshold' | 'manual' | 'recover';
  useMockAi?: boolean;
  force?: boolean;
}

export type SeriesPublishingMode = 'tick' | 'enqueue_one' | 'recover';

export interface SeriesPublishingPayload {
  mode: SeriesPublishingMode;
  userId?: string;
  seriesScheduleId?: string;
  useMockSocial?: boolean;
  force?: boolean;
}

export type SeriesMaintenanceMode =
  | 'recover_stuck'
  | 'missed_schedules'
  | 'cleanup'
  | 'disk_check';

export interface SeriesMaintenancePayload {
  mode: SeriesMaintenanceMode;
  userId?: string;
  laneId?: string;
}
