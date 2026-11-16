/**
 * Series Studio autonomy policy.
 * FULLY_AUTONOMOUS overrides legacy approval switches without deleting them.
 * Mock AI is intentionally unrelated — do not couple useMockAi to autonomyMode.
 */

export const SERIES_AUTONOMY_MODES = ['MANUAL', 'FULLY_AUTONOMOUS'] as const;
export type SeriesAutonomyMode = (typeof SERIES_AUTONOMY_MODES)[number];

export type SeriesAutonomyConfigSlice = {
  autonomyMode?: string | null;
  movieApprovalRequired?: boolean | null;
  episodeApprovalRequired?: boolean | null;
  automaticReplacementApproval?: boolean | null;
  automaticMoviePlanning?: boolean | null;
  automaticEpisodeProduction?: boolean | null;
  automaticPublishing?: boolean | null;
  automaticReplacementPlanning?: boolean | null;
};

export function isFullyAutonomous(
  config: Pick<SeriesAutonomyConfigSlice, 'autonomyMode'> | null | undefined,
): boolean {
  return config?.autonomyMode === 'FULLY_AUTONOMOUS';
}

/** Effective movie approval gate — false when fully autonomous. */
export function effectiveMovieApprovalRequired(
  config: SeriesAutonomyConfigSlice | null | undefined,
): boolean {
  if (isFullyAutonomous(config)) return false;
  return config?.movieApprovalRequired !== false;
}

/** Effective episode approval gate — false when fully autonomous. */
export function effectiveEpisodeApprovalRequired(
  config: SeriesAutonomyConfigSlice | null | undefined,
): boolean {
  if (isFullyAutonomous(config)) return false;
  return config?.episodeApprovalRequired !== false;
}

/** Effective replacement auto-approve — true when fully autonomous. */
export function effectiveAutomaticReplacementApproval(
  config: SeriesAutonomyConfigSlice | null | undefined,
): boolean {
  if (isFullyAutonomous(config)) return true;
  return config?.automaticReplacementApproval === true;
}

/** Whether autonomous mode should activate an approved replacement without a human click. */
export function shouldAutoActivateReplacement(
  config: SeriesAutonomyConfigSlice | null | undefined,
): boolean {
  return isFullyAutonomous(config);
}

/**
 * Resolve autonomy + legacy flags for API/UI responses.
 * Stored legacy booleans remain visible; `effective*` reflects runtime gates.
 */
export function resolveSeriesAutonomyPolicy(config: SeriesAutonomyConfigSlice) {
  const autonomyMode: SeriesAutonomyMode =
    config.autonomyMode === 'FULLY_AUTONOMOUS' ? 'FULLY_AUTONOMOUS' : 'MANUAL';
  const fullyAutonomous = autonomyMode === 'FULLY_AUTONOMOUS';

  return {
    autonomyMode,
    fullyAutonomous,
    movieApprovalRequired: config.movieApprovalRequired !== false,
    episodeApprovalRequired: config.episodeApprovalRequired !== false,
    automaticReplacementApproval: config.automaticReplacementApproval === true,
    effectiveMovieApprovalRequired: effectiveMovieApprovalRequired(config),
    effectiveEpisodeApprovalRequired: effectiveEpisodeApprovalRequired(config),
    effectiveAutomaticReplacementApproval: effectiveAutomaticReplacementApproval(config),
    autonomyOverridesApprovals: fullyAutonomous,
    /** Legacy switches that are overridden (not deleted) while autonomous. */
    overriddenByAutonomy: fullyAutonomous
      ? ([
          'movieApprovalRequired',
          'episodeApprovalRequired',
          'automaticReplacementApproval',
        ] as const)
      : ([] as const),
  };
}
