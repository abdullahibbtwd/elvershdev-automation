import { api } from './api';

export type SeriesCreativeSettings = {
  genres?: string[];
  themes?: string[];
  excludedThemes?: string[];
  targetAudience?: string;
  language?: string;
  tone?: string;
  dialogueStyle?: string;
  narrativeTone?: string;
  storytellingRules?: string[];
  contentExclusions?: string[];
  characterPreferences?: string;
  endingPreferences?: string;
  cliffhangerIntensity?: 'low' | 'medium' | 'high';
  visualStyle?: string;
  characterConsistencyRequired?: boolean;
  narrationPreferences?: string;
  episodeDurationSeconds?: number;
  episodesPerMovie?: number;
  aspectRatio?: string;
  storyConcept?: string;
  customCreativeInstructions?: string;
  dialogueDrivenStorytelling?: boolean;
  narrationPreference?: 'avoid' | 'allowed' | 'required';
  dialogueDensity?: 'low' | 'medium' | 'high';
  characterVoiceStyle?: string;
  accentPreference?: string;
  dialogueLanguage?: string;
  lipSyncRequired?: boolean;
  subtitlePreference?: boolean;
  cinematicShotStyle?: string;
  characterAnimationStyle?: string;
};

export type SeriesProductionStartMode =
  | 'IMMEDIATE'
  | 'NEXT_WINDOW'
  | 'CUSTOM'
  | 'MANUAL';

export type SeriesAutonomyMode = 'MANUAL' | 'FULLY_AUTONOMOUS';

export type SeriesConfig = {
  seriesStudioEnabled: boolean;
  runMode: string;
  autonomyMode: SeriesAutonomyMode;
  fullyAutonomous?: boolean;
  autonomyOverridesApprovals?: boolean;
  overriddenByAutonomy?: string[];
  effectiveMovieApprovalRequired?: boolean;
  effectiveEpisodeApprovalRequired?: boolean;
  effectiveAutomaticReplacementApproval?: boolean;
  morningLaneEnabled: boolean;
  eveningLaneEnabled: boolean;
  automaticMoviePlanning: boolean;
  automaticEpisodeProduction: boolean;
  automaticCharacterGeneration: boolean;
  automaticEpisodeScriptGeneration: boolean;
  automaticVisualGeneration: boolean;
  automaticMotionGeneration: boolean;
  automaticNarration: boolean;
  automaticRendering: boolean;
  automaticPublishing: boolean;
  automaticReplacementPlanning: boolean;
  automaticReplacementApproval: boolean;
  episodeApprovalRequired: boolean;
  movieApprovalRequired: boolean;
  startMediaAfterMoviePlanning: boolean;
  defaultProductionStartMode: SeriesProductionStartMode;
  defaultProductionLeadTimeMinutes: number;
  defaultPlannedEpisodeCount: number;
  defaultEpisodeDurationSeconds: number;
  defaultReplacementTriggerEpisode: number;
  maxConcurrentEpisodeProduction: number;
  maxRetries: number;
  qualityAcceptanceThreshold: number;
  language: string;
  tone: string;
  visualDirection: string;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  maxCostPerEpisodeUsd: number | null;
  activeChannelIds: string[];
  channelPublishingEnabled: Record<string, boolean>;
  creativeSettings?: SeriesCreativeSettings;
  emergencyStopAt?: string | null;
};

export type SeriesLane = {
  id: string;
  laneType: 'MORNING' | 'EVENING' | 'CUSTOM';
  name: string;
  description?: string | null;
  enabled: boolean;
  status: string;
  publishTime: string;
  timezone: string;
  productionLeadTimeMinutes: number;
  preferredProductionTime?: string | null;
  productionStartMode: SeriesProductionStartMode;
  customProductionStartAt?: string | null;
  plannedEpisodeCount: number;
  targetEpisodeDurationSeconds: number;
  replacementTriggerEpisode: number;
  currentEpisodeNumber: number;
  lastPublishedEpisodeNumber: number;
  nextPublishAt: string | null;
  nextProductionAt?: string | null;
  lastPublishedAt: string | null;
  activeSeriesId: string | null;
  sortOrder?: number;
  creativeSettings?: SeriesCreativeSettings;
  activeSeries?: {
    id: string;
    title: string;
    slug: string;
    status: string;
    plannedEpisodeCount: number;
    currentEpisodeNumber: number;
    approvalStatus: string;
  } | null;
};

export type SeriesExecution = {
  id: string;
  laneId: string;
  triggerSource: string;
  requestedAction: string;
  resolvedAction: string | null;
  status: string;
  seriesId: string | null;
  episodeId: string | null;
  errorMessage: string | null;
  resultSummary?: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  lane?: { id: string; name: string; laneType: string };
};

export type LaneExecutionView = {
  laneId: string;
  name: string;
  displayState: string;
  nextAction: string;
  nextActionReason: string;
  productionStage: string | null;
  productionStartMode?: SeriesProductionStartMode;
  productionLeadTimeMinutes?: number;
  preferredProductionTime?: string | null;
  nextPublishAt?: string | Date | null;
  nextProductionAt?: string | Date | null;
  currentEpisode?: {
    id: string;
    episodeNumber: number;
    status: string;
    approvalStatus: string;
    blockedReason: string | null;
  } | null;
  nextEpisode?: {
    id: string;
    episodeNumber: number;
    status: string;
    approvalStatus: string;
  } | null;
  lastPublishedEpisode?: {
    id: string;
    episodeNumber: number;
    publishedAt: string | Date | null;
  } | null;
  blocker?: string | null;
  approvalStatus?: string | null;
  activeMovie?: {
    id: string;
    title: string;
    status: string;
    approvalStatus: string;
    currentEpisodeNumber: number;
    plannedEpisodeCount: number;
  } | null;
  lastExecution: SeriesExecution | null;
  activeExecution: SeriesExecution | null;
};

export type StorySeriesListItem = {
  id: string;
  title: string;
  slug: string;
  logline: string | null;
  genre: string | null;
  status: string;
  approvalStatus: string;
  plannedEpisodeCount: number;
  currentEpisodeNumber: number;
  isReplacementCandidate: boolean;
  lane: { id: string; laneType: string; name?: string };
  _count: { episodes: number; characters: number };
  createdAt: string;
};

export type SeriesEpisode = {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string | null;
  script: string | null;
  hook: string | null;
  ending: string | null;
  cliffhanger: string | null;
  narrationText: string | null;
  status: string;
  approvalStatus: string;
  productionState: string;
  targetDurationSeconds: number;
  spokenWordCount: number | null;
  storyId: string | null;
  videoRenderId: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  lastError: string | null;
  scenes?: Array<{
    id: string;
    sceneOrder: number;
    location: string;
    action: string;
    visualDescription: string;
    narration: string | null;
    dialogue: string | null;
  }>;
};

export type SeriesCharacter = {
  id: string;
  name: string;
  role: string;
  species: string;
  personality: string;
  physicalDescription: string;
  canonicalVisualDescription: string | null;
  lifecycleStatus: string;
  approvedAt: string | null;
  referenceAssets?: Array<{
    id: string;
    isPrimary: boolean;
    isApproved: boolean;
    mediaAsset?: { id: string; publicUrl?: string | null; storageKey?: string } | null;
  }>;
};

export type SeriesDetail = {
  id: string;
  title: string;
  slug: string;
  logline: string | null;
  synopsis: string | null;
  genre: string | null;
  status: string;
  approvalStatus: string;
  plannedEpisodeCount: number;
  currentEpisodeNumber: number;
  language: string;
  tone: string | null;
  bible: {
    premise: string;
    worldRules: string;
    setting: string;
    masterPlot: string;
    beginning: string;
    middle: string;
    ending: string;
  } | null;
  characters: SeriesCharacter[];
  episodes: SeriesEpisode[];
  lane: { id: string; laneType: string; status: string; name?: string };
};

async function data<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export const SERIES_GENRE_OPTIONS = [
  'Family drama',
  'Mystery thriller',
  'Romantic drama',
  'Crime drama',
  'Social drama',
  'Revenge',
  'Suspense',
  'Betrayal',
  'Supernatural',
  'Cinematic drama',
] as const;

export const SERIES_THEME_OPTIONS = [
  'Jealousy',
  'Greed',
  'Family conflict',
  'Favouritism',
  'Inheritance disputes',
  'Manipulation',
  'Hidden secrets',
  'Deception',
  'Power struggles',
  'Sibling rivalry',
] as const;

export const seriesApi = {
  getConfig: () => data<SeriesConfig>(api.get('/series/config')),
  updateConfig: (body: Partial<SeriesConfig>) =>
    data<SeriesConfig>(api.patch('/series/config', body)),
  enable: () => data<SeriesConfig>(api.post('/series/config/enable')),
  pause: () => data<SeriesConfig>(api.post('/series/config/pause')),
  resume: () => data<SeriesConfig>(api.post('/series/config/resume')),
  emergencyStop: () => data<SeriesConfig>(api.post('/series/config/emergency-stop')),

  listLanes: () => data<SeriesLane[]>(api.get('/series/lanes')),
  createLane: (body: {
    name: string;
    description?: string;
    publishTime?: string;
    timezone?: string;
    creativeSettings?: SeriesCreativeSettings;
  }) => data<SeriesLane>(api.post('/series/lanes', body)),
  updateLane: (id: string, body: Record<string, unknown>) =>
    data<SeriesLane>(api.patch(`/series/lanes/${id}`, body)),
  duplicateLane: (id: string) => data<SeriesLane>(api.post(`/series/lanes/${id}/duplicate`)),
  deleteLane: (id: string) => data<SeriesLane>(api.delete(`/series/lanes/${id}`)),
  pauseLane: (id: string) => data<SeriesLane>(api.post(`/series/lanes/${id}/pause`)),
  resumeLane: (id: string) => data<SeriesLane>(api.post(`/series/lanes/${id}/resume`)),
  ensureSchedule: (laneId: string) =>
    data<unknown>(api.post(`/series/lanes/${laneId}/ensure-schedule`)),
  replaceLane: (laneId: string, body?: { async?: boolean; useMockAi?: boolean; force?: boolean }) =>
    data<unknown>(api.post(`/series/lanes/${laneId}/replace`, body ?? { async: true })),
  listReplacements: (laneId: string) => data<unknown[]>(api.get(`/series/lanes/${laneId}/replacements`)),
  approveReplacement: (planId: string, activate?: boolean) =>
    data<unknown>(api.post(`/series/replacements/${planId}/approve`, { activate: activate === true })),
  activateReplacement: (planId: string) =>
    data<unknown>(api.post(`/series/replacements/${planId}/activate`)),
  rejectReplacement: (planId: string, reason?: string) =>
    data<unknown>(api.post(`/series/replacements/${planId}/reject`, { reason })),

  runLaneNow: (
    laneId: string,
    body?: { useMockAi?: boolean; customPremise?: string; useCustomIdea?: boolean },
  ) => data<Record<string, unknown>>(api.post(`/series/lanes/${laneId}/run-now`, body ?? {})),
  runAllNow: (body?: { useMockAi?: boolean }) =>
    data<{ message: string; results: Array<Record<string, unknown>> }>(
      api.post('/series/run-all-now', body ?? {}),
    ),
  planMovies: (body?: {
    lanes?: Array<{ laneId: string; ideaMode?: 'generate' | 'custom'; customPremise?: string }>;
    startMediaProduction?: boolean;
    useMockAi?: boolean;
    async?: boolean;
  }) => data<Record<string, unknown>>(api.post('/series/plan-movies', body ?? {})),
  prepareNextEpisodes: (body?: {
    laneIds?: string[];
    useMockAi?: boolean;
    ignoreScheduleWindow?: boolean;
  }) => data<{ results: Array<Record<string, unknown>> }>(
    api.post('/series/prepare-next-episodes', body ?? {}),
  ),
  produceNextEpisode: (laneId: string, body?: { useMockAi?: boolean }) =>
    data<Record<string, unknown>>(api.post(`/series/lanes/${laneId}/produce-next`, body ?? {})),
  listExecutions: (params?: { laneId?: string; take?: number }) =>
    data<{ items: SeriesExecution[]; total: number }>(api.get('/series/executions', { params })),
  getExecution: (id: string) => data<SeriesExecution>(api.get(`/series/executions/${id}`)),
  laneExecutionView: (laneId: string) =>
    data<LaneExecutionView>(api.get(`/series/lanes/${laneId}/execution-view`)),

  schedulerStatus: () => data<Record<string, unknown>>(api.get('/series/scheduler/status')),
  reconcilePublishing: () => data<unknown>(api.post('/series/publishing/reconcile')),

  generate: (body: {
    laneId: string;
    genre?: string;
    theme?: string;
    plannedEpisodeCount?: number;
    targetEpisodeDurationSeconds?: number;
    additionalInstructions?: string;
    customPremise?: string;
    ideaMode?: 'generate' | 'custom';
    useMockAi?: boolean;
    async?: boolean;
  }) => data<unknown>(api.post('/series/generate', body)),

  listSeries: (params?: { laneId?: string; status?: string; take?: number }) =>
    data<{ items: StorySeriesListItem[]; total: number }>(api.get('/series', { params })),
  getSeries: (id: string) => data<SeriesDetail>(api.get(`/series/${id}`)),
  getBible: (id: string) => data<unknown>(api.get(`/series/${id}/bible`)),
  approveSeries: (id: string) => data<unknown>(api.post(`/series/${id}/approve`)),
  rejectSeries: (id: string, reason?: string) =>
    data<unknown>(api.post(`/series/${id}/reject`, { reason })),

  listCharacters: (seriesId: string) =>
    data<SeriesCharacter[]>(api.get(`/series/${seriesId}/characters`)),
  generateCharacterRefs: (seriesId: string) =>
    data<unknown>(api.post(`/series/${seriesId}/characters/references`)),
  generateOneCharacterRef: (seriesId: string, characterId: string) =>
    data<unknown>(api.post(`/series/${seriesId}/characters/${characterId}/references`)),

  getEpisode: (seriesId: string, episodeId: string) =>
    data<SeriesEpisode>(api.get(`/series/${seriesId}/episodes/${episodeId}`)),
  generateEpisode: (
    seriesId: string,
    episodeId: string,
    body?: { useMockAi?: boolean; async?: boolean },
  ) => data<unknown>(api.post(`/series/${seriesId}/episodes/${episodeId}/generate`, body ?? {})),
  regenerateEpisode: (
    seriesId: string,
    episodeId: string,
    body?: { useMockAi?: boolean; async?: boolean },
  ) =>
    data<unknown>(api.post(`/series/${seriesId}/episodes/${episodeId}/regenerate`, body ?? {})),
  approveEpisode: (seriesId: string, episodeId: string) =>
    data<unknown>(api.post(`/series/${seriesId}/episodes/${episodeId}/approve`)),
  validateContinuity: (
    seriesId: string,
    episodeId: string,
    stage: 'pre_script_approval' | 'pre_visual' = 'pre_script_approval',
  ) =>
    data<unknown>(
      api.post(`/series/${seriesId}/episodes/${episodeId}/validate-continuity`, {}, {
        params: { stage },
      }),
    ),
  produceEpisode: (
    seriesId: string,
    episodeId: string,
    body?: { useMockAi?: boolean; async?: boolean; force?: boolean },
  ) => data<unknown>(api.post(`/series/${seriesId}/episodes/${episodeId}/produce`, body ?? {})),
  getProduction: (seriesId: string, episodeId: string) =>
    data<unknown>(api.get(`/series/${seriesId}/episodes/${episodeId}/production`)),
  cancelProduction: (seriesId: string, episodeId: string) =>
    data<unknown>(api.post(`/series/${seriesId}/episodes/${episodeId}/production/cancel`)),
  getContinuity: (seriesId: string) => data<unknown>(api.get(`/series/${seriesId}/continuity`)),
};
