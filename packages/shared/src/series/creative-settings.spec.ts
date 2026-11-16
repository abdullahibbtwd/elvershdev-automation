import {
  creativeSettingsToBriefFields,
  mergeSeriesCreativeSettings,
  parseSeriesCreativeSettings,
  seriesCreativeSettingsSchema,
} from './creative-settings';

describe('series creative settings', () => {
  it('parses empty and partial settings', () => {
    expect(parseSeriesCreativeSettings(null).genres).toEqual([]);
    expect(seriesCreativeSettingsSchema.parse({ genres: ['Revenge'] }).genres).toEqual([
      'Revenge',
    ]);
  });

  it('merges with lane overriding global', () => {
    const merged = mergeSeriesCreativeSettings(
      { genres: ['Family drama'], tone: 'Warm' },
      { genres: ['Crime drama'], storyConcept: 'Heirloom theft' },
    );
    expect(merged.genres).toEqual(['Crime drama']);
    expect(merged.tone).toBe('Warm');
    expect(merged.storyConcept).toBe('Heirloom theft');
  });

  it('maps creative settings into Movie Architect brief fields', () => {
    const fields = creativeSettingsToBriefFields(
      seriesCreativeSettingsSchema.parse({
        genres: ['Mystery thriller', 'Suspense'],
        themes: ['Hidden secrets'],
        dialogueStyle: 'Terse',
        cliffhangerIntensity: 'high',
        episodesPerMovie: 8,
        episodeDurationSeconds: 45,
      }),
    );
    expect(fields.genre).toBe('Mystery thriller');
    expect(fields.subgenres).toEqual(['Suspense']);
    expect(fields.plannedEpisodeCount).toBe(8);
    expect(fields.additionalInstructions).toContain('Cliffhanger intensity: high');
  });
});
