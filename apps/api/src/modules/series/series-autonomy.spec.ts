import {
  effectiveAutomaticReplacementApproval,
  effectiveEpisodeApprovalRequired,
  effectiveMovieApprovalRequired,
  isFullyAutonomous,
  resolveSeriesAutonomyPolicy,
  shouldAutoActivateReplacement,
} from '@ai-video/shared';

/**
 * Acceptance-oriented unit coverage for autonomy policy (criteria 1–7 subset).
 * Full mock-provider E2E still requires Nest + Redis + DB.
 */
describe('Series FULLY_AUTONOMOUS policy (acceptance)', () => {
  const autonomous = {
    autonomyMode: 'FULLY_AUTONOMOUS' as const,
    movieApprovalRequired: true,
    episodeApprovalRequired: true,
    automaticReplacementApproval: false,
  };

  const manual = {
    autonomyMode: 'MANUAL' as const,
    movieApprovalRequired: true,
    episodeApprovalRequired: true,
    automaticReplacementApproval: false,
  };

  it('1–2. does not require movie or episode approval when fully autonomous', () => {
    expect(effectiveMovieApprovalRequired(autonomous)).toBe(false);
    expect(effectiveEpisodeApprovalRequired(autonomous)).toBe(false);
  });

  it('7. Manual Mode retains approval workflow', () => {
    expect(effectiveMovieApprovalRequired(manual)).toBe(true);
    expect(effectiveEpisodeApprovalRequired(manual)).toBe(true);
    expect(isFullyAutonomous(manual)).toBe(false);
  });

  it('replacement auto-approve + activate under autonomy', () => {
    expect(effectiveAutomaticReplacementApproval(autonomous)).toBe(true);
    expect(shouldAutoActivateReplacement(autonomous)).toBe(true);
    expect(shouldAutoActivateReplacement(manual)).toBe(false);
  });

  it('preserves stored legacy flags while reporting effective overrides', () => {
    const policy = resolveSeriesAutonomyPolicy(autonomous);
    expect(policy.movieApprovalRequired).toBe(true);
    expect(policy.effectiveMovieApprovalRequired).toBe(false);
    expect(policy.autonomyOverridesApprovals).toBe(true);
    expect(policy.overriddenByAutonomy).toEqual(
      expect.arrayContaining([
        'movieApprovalRequired',
        'episodeApprovalRequired',
        'automaticReplacementApproval',
      ]),
    );
  });

  it('does not treat mock AI as autonomy', () => {
    // useMockAi is intentionally absent from the policy slice.
    expect(isFullyAutonomous({ autonomyMode: 'MANUAL' })).toBe(false);
    expect(isFullyAutonomous({ autonomyMode: 'FULLY_AUTONOMOUS' })).toBe(true);
  });
});
