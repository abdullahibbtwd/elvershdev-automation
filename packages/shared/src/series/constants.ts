export const SERIES_DEFAULTS = {
  morningPublishTime: '08:00',
  eveningPublishTime: '19:00',
  /** Product default for new lanes; existing rows are not rewritten by migration. */
  timezone: 'Africa/Lagos',
  autonomyMode: 'MANUAL' as const,
  /** Individual episode default — not complete-story duration and not clip duration. */
  targetEpisodeDurationSeconds: 60,
  /** Complete story/movie default when only count×episode is used (10×60s). */
  targetStoryDurationSeconds: 600,
  /** Grok Lite max per generation request. */
  maxClipDurationSeconds: 15,
  productionFormat: 'episodic' as const,
  plannedEpisodeCount: 10,
  replacementTriggerEpisode: 8,
  maxConcurrentEpisodeProduction: 1,
  maxRetries: 3,
  language: 'en',
  tone: 'Cinematic drama',
  visualDirection: 'Mature premium cinematic 3D animation',
  spokenWordsPerSixtySecondsMin: 110,
  spokenWordsPerSixtySecondsMax: 135,
  automaticReplacementApproval: false,
  episodeApprovalRequired: true,
  movieApprovalRequired: true,
  automaticEpisodeProduction: true,
  automaticMotionGeneration: true,
  startMediaAfterMoviePlanning: false,
  defaultProductionLeadTimeMinutes: 240,
  defaultProductionStartMode: 'NEXT_WINDOW' as const,
  qualityAcceptanceThreshold: 0.7,
} as const;

export const SERIES_LANE_TYPES = ['MORNING', 'EVENING', 'CUSTOM'] as const;
export type SeriesLaneTypeName = (typeof SERIES_LANE_TYPES)[number];

export const SERIES_EXECUTION_STATES = [
  'Idle',
  'Queued',
  'Planning Movie',
  'Generating Characters',
  'Planning Episode',
  'Awaiting Approval',
  'Generating Visuals',
  'Generating Motion',
  'Generating Narration',
  'Rendering',
  'Ready to Publish',
  'Publishing',
  'Published',
  'Failed',
  'Cancelled',
] as const;

export type SeriesExecutionStateLabel = (typeof SERIES_EXECUTION_STATES)[number];

export const SERIES_NOTIFICATION_TYPES = {
  MOVIE_PLANNED: 'series.movie_planned',
  REPLACEMENT_READY: 'series.replacement_ready',
  EPISODE_NEEDS_APPROVAL: 'series.episode_needs_approval',
  EPISODE_RENDERED: 'series.episode_rendered',
  EPISODE_SCHEDULED: 'series.episode_scheduled',
  EPISODE_PUBLISHED: 'series.episode_published',
  PRODUCTION_FAILED: 'series.production_failed',
  NO_READY_EPISODE: 'series.no_ready_episode',
  BUDGET_REACHED: 'series.budget_reached',
  LANE_PAUSED: 'series.lane_paused',
  LANE_RESUMED: 'series.lane_resumed',
} as const;

/** Feature switches that must gate new Series work when false. */
export const SERIES_FEATURE_SWITCHES = [
  'seriesStudioEnabled',
  'morningLaneEnabled',
  'eveningLaneEnabled',
  'autonomyMode',
  'automaticMoviePlanning',
  'automaticEpisodeProduction',
  'automaticCharacterGeneration',
  'automaticEpisodeScriptGeneration',
  'automaticVisualGeneration',
  'automaticMotionGeneration',
  'automaticNarration',
  'automaticRendering',
  'automaticPublishing',
  'automaticReplacementPlanning',
  'automaticReplacementApproval',
  'episodeApprovalRequired',
  'movieApprovalRequired',
  'startMediaAfterMoviePlanning',
] as const;

export type SeriesFeatureSwitch = (typeof SERIES_FEATURE_SWITCHES)[number];

/**
 * @deprecated Legacy fal / Hailuo / narration episode path. Kept only for type compatibility
 * with old run rows. Series Studio no longer starts or advances these stages.
 */
export const SERIES_PRODUCTION_STAGE_ORDER = [
  'MATERIALIZE',
  'VISUAL_INTELLIGENCE',
  'MOTION_GENERATION',
  'NARRATION',
  'SPEECH',
  'RENDER',
  'DONE',
] as const;

export type SeriesProductionStageName = (typeof SERIES_PRODUCTION_STAGE_ORDER)[number];

/**
 * Series Studio production stages for every lane (morning / evening / custom).
 * Script → materialize → Grok text-to-video clips → FFmpeg assemble.
 * No fal stills, Hailuo motion, TTS narration, or lip-sync stages.
 */
export const SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER = [
  'MATERIALIZE',
  'CLIP_GENERATION',
  'ASSEMBLY',
  'DONE',
] as const;

/** In-flight runs may still sit on these stages from the old fal/lip-sync path. */
export const SERIES_DIALOGUE_LEGACY_STAGES = [
  'VOICE_ASSIGNMENT',
  'VISUAL_INTELLIGENCE',
  'DIALOGUE_AUDIO',
  'LIP_SYNC',
  'AUDIO_MIX',
] as const;

export type SeriesDialogueProductionStageName =
  | (typeof SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER)[number]
  | (typeof SERIES_DIALOGUE_LEGACY_STAGES)[number];

export type SeriesAnyProductionStageName =
  | SeriesProductionStageName
  | SeriesDialogueProductionStageName;

export function nextSeriesProductionStage(
  stage: SeriesProductionStageName,
): SeriesProductionStageName | null {
  const index = SERIES_PRODUCTION_STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= SERIES_PRODUCTION_STAGE_ORDER.length - 1) {
    return null;
  }
  return SERIES_PRODUCTION_STAGE_ORDER[index + 1];
}

export function nextSeriesDialogueProductionStage(
  stage: SeriesDialogueProductionStageName,
): SeriesDialogueProductionStageName | null {
  const index = SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER.indexOf(
    stage as (typeof SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER)[number],
  );
  if (index >= 0) {
    if (index >= SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER.length - 1) return null;
    return SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER[index + 1];
  }
  // Skip abandoned fal / TTS / lip-sync stages → jump to Grok clips.
  if ((SERIES_DIALOGUE_LEGACY_STAGES as readonly string[]).includes(stage)) {
    return 'CLIP_GENERATION';
  }
  return null;
}
