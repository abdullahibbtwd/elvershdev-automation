import {
  effectiveAutomaticReplacementApproval,
  effectiveEpisodeApprovalRequired,
  effectiveMovieApprovalRequired,
  isFullyAutonomous,
  resolveSeriesAutonomyPolicy,
  shouldAutoActivateReplacement,
} from './autonomy';

describe('Series autonomy policy', () => {
  it('defaults MANUAL behaviour — approvals required, replacement not auto', () => {
    const config = {
      autonomyMode: 'MANUAL',
      movieApprovalRequired: true,
      episodeApprovalRequired: true,
      automaticReplacementApproval: false,
    };
    expect(isFullyAutonomous(config)).toBe(false);
    expect(effectiveMovieApprovalRequired(config)).toBe(true);
    expect(effectiveEpisodeApprovalRequired(config)).toBe(true);
    expect(effectiveAutomaticReplacementApproval(config)).toBe(false);
    expect(shouldAutoActivateReplacement(config)).toBe(false);
  });

  it('FULLY_AUTONOMOUS overrides legacy approval switches without deleting them', () => {
    const config = {
      autonomyMode: 'FULLY_AUTONOMOUS',
      movieApprovalRequired: true,
      episodeApprovalRequired: true,
      automaticReplacementApproval: false,
    };
    expect(effectiveMovieApprovalRequired(config)).toBe(false);
    expect(effectiveEpisodeApprovalRequired(config)).toBe(false);
    expect(effectiveAutomaticReplacementApproval(config)).toBe(true);
    expect(shouldAutoActivateReplacement(config)).toBe(true);

    const policy = resolveSeriesAutonomyPolicy(config);
    expect(policy.movieApprovalRequired).toBe(true);
    expect(policy.effectiveMovieApprovalRequired).toBe(false);
    expect(policy.autonomyOverridesApprovals).toBe(true);
    expect(policy.overriddenByAutonomy).toContain('movieApprovalRequired');
  });

  it('does not treat missing autonomyMode as autonomous', () => {
    expect(isFullyAutonomous({})).toBe(false);
    expect(isFullyAutonomous({ autonomyMode: 'MANUAL' })).toBe(false);
    expect(effectiveMovieApprovalRequired({ movieApprovalRequired: false })).toBe(false);
  });
});
