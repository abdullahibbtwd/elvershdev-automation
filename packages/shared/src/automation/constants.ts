export const AUTOMATION_DEFAULTS = {
  dailyGenerationTarget: 2,
  monthlyGenerationTarget: 60,
  timezone: 'UTC',
  preferredPublishingDays: [1, 2, 3, 4, 5],
  includeWeekends: true,
  publishingWindowStart: '09:00',
  publishingWindowEnd: '21:00',
  minIntervalMinutes: 60,
  maxDailyPublishingAttempts: 20,
  targetDurationSeconds: 60,
  language: 'en',
  maxConcurrentGeneration: 2,
  maxConcurrentPublishing: 4,
  maxRetries: 3,
  maxGenerationAttempts: 3,
  maxImageGenerationsPerScene: 3,
  maxMotionAttemptsPerScene: 3,
  channelPublishingEnabled: {
    FACEBOOK: true,
    INSTAGRAM: true,
    TIKTOK: true,
    YOUTUBE: true,
  },
  contentCategories: ['Narrative', 'Motivation'],
  storyGenres: ['Cinematic storytelling'],
} as const;

export const AUTOMATION_NOTIFICATION_TYPES = {
  DAILY_STARTED: 'automation.daily_started',
  RENDER_COMPLETED: 'automation.render_completed',
  VIDEO_SCHEDULED: 'automation.video_scheduled',
  PUBLISH_SUCCESS: 'automation.publish_success',
  PUBLISH_PARTIAL_FAILURE: 'automation.publish_partial_failure',
  PUBLISH_COMPLETE_FAILURE: 'automation.publish_complete_failure',
  BUDGET_REACHED: 'automation.budget_reached',
  PAUSED_OR_BLOCKED: 'automation.paused_or_blocked',
  CREDENTIALS_ISSUE: 'automation.credentials_issue',
} as const;

export const AUTOMATION_STAGE_ORDER = [
  'PLANNING',
  'STORY_GENERATION',
  'SCENE_PLANNING',
  'VISUAL_INTELLIGENCE',
  'MOTION_GENERATION',
  'NARRATION',
  'SPEECH',
  'RENDER',
  'PUBLISH_SCHEDULE',
  'DONE',
] as const;

export type AutomationStageName = (typeof AUTOMATION_STAGE_ORDER)[number];

export function nextAutomationStage(
  stage: AutomationStageName,
): AutomationStageName | null {
  const index = AUTOMATION_STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= AUTOMATION_STAGE_ORDER.length - 1) {
    return null;
  }
  return AUTOMATION_STAGE_ORDER[index + 1];
}

export function automationStageProgress(stage: AutomationStageName): number {
  const index = AUTOMATION_STAGE_ORDER.indexOf(stage);
  if (index < 0) return 0;
  return Math.round((index / (AUTOMATION_STAGE_ORDER.length - 1)) * 100);
}
