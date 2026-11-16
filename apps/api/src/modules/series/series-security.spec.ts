import {
  SERIES_DEFAULTS,
  SERIES_FEATURE_SWITCHES,
  SERIES_NOTIFICATION_TYPES,
  resolveSeriesAutonomyPolicy,
} from '@ai-video/shared';

describe('Series Studio security / safety defaults', () => {
  it('keeps automatic replacement approval OFF by default', () => {
    expect(SERIES_DEFAULTS.automaticReplacementApproval).toBe(false);
  });

  it('defaults autonomyMode to MANUAL so existing users are not silently flipped', () => {
    expect(SERIES_DEFAULTS.autonomyMode).toBe('MANUAL');
    const policy = resolveSeriesAutonomyPolicy({
      autonomyMode: SERIES_DEFAULTS.autonomyMode,
      movieApprovalRequired: SERIES_DEFAULTS.movieApprovalRequired,
      episodeApprovalRequired: SERIES_DEFAULTS.episodeApprovalRequired,
      automaticReplacementApproval: SERIES_DEFAULTS.automaticReplacementApproval,
    });
    expect(policy.fullyAutonomous).toBe(false);
    expect(policy.effectiveMovieApprovalRequired).toBe(true);
  });

  it('defaults episode production concurrency to 1', () => {
    expect(SERIES_DEFAULTS.maxConcurrentEpisodeProduction).toBe(1);
  });

  it('defaults new-lane timezone to Africa/Lagos', () => {
    expect(SERIES_DEFAULTS.timezone).toBe('Africa/Lagos');
  });

  it('requires feature switches that gate automated work', () => {
    expect(SERIES_FEATURE_SWITCHES).toEqual(
      expect.arrayContaining([
        'seriesStudioEnabled',
        'autonomyMode',
        'automaticEpisodeProduction',
        'automaticMotionGeneration',
        'automaticPublishing',
        'automaticReplacementApproval',
        'episodeApprovalRequired',
        'movieApprovalRequired',
      ]),
    );
  });

  it('defaults production scheduling to next window with 4h lead', () => {
    expect(SERIES_DEFAULTS.defaultProductionStartMode).toBe('NEXT_WINDOW');
    expect(SERIES_DEFAULTS.defaultProductionLeadTimeMinutes).toBe(240);
    expect(SERIES_DEFAULTS.startMediaAfterMoviePlanning).toBe(false);
  });

  it('defines notification types for failure and approval gates', () => {
    expect(SERIES_NOTIFICATION_TYPES.EPISODE_NEEDS_APPROVAL).toBe('series.episode_needs_approval');
    expect(SERIES_NOTIFICATION_TYPES.PRODUCTION_FAILED).toBe('series.production_failed');
    expect(SERIES_NOTIFICATION_TYPES.REPLACEMENT_READY).toBe('series.replacement_ready');
  });
});

describe('Series ownership query patterns', () => {
  it('documents the required ownership filter shape for episode lookups', () => {
    const userId = 'user-a';
    const seriesId = 'series-1';
    const episodeId = 'ep-1';
    const where = { id: episodeId, seriesId, series: { userId } };
    expect(where.series.userId).toBe(userId);
    expect(where).not.toEqual({ id: episodeId });
  });

  it('scopes publish claim filters by optional userId', () => {
    const scheduleId = 'sched-1';
    const userId = 'user-a';
    const where = {
      id: scheduleId,
      ...(userId ? { userId } : {}),
      state: 'SCHEDULED',
    };
    expect(where).toMatchObject({ id: scheduleId, userId, state: 'SCHEDULED' });
  });
});
