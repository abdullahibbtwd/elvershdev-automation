import {
  creativeSettingsToBriefFields,
  mergeSeriesCreativeSettings,
  parseSeriesCreativeSettings,
  seriesCreativeSettingsSchema,
} from '@ai-video/shared';

describe('Series creative settings (shared helpers, mock-only)', () => {
  it('persists-shaped parse + merge with lane override', () => {
    expect(parseSeriesCreativeSettings(null).genres).toEqual([]);
    const merged = mergeSeriesCreativeSettings(
      { genres: ['Family drama'], tone: 'Warm' },
      { genres: ['Crime drama'], storyConcept: 'Heirloom theft' },
    );
    expect(merged.genres).toEqual(['Crime drama']);
    expect(merged.tone).toBe('Warm');
    expect(merged.storyConcept).toBe('Heirloom theft');
  });

  it('injects creative fields into Movie Architect brief mapping', () => {
    const fields = creativeSettingsToBriefFields(
      seriesCreativeSettingsSchema.parse({
        genres: ['Mystery thriller', 'Suspense'],
        themes: ['Hidden secrets'],
        dialogueStyle: 'Terse',
        cliffhangerIntensity: 'high',
        episodesPerMovie: 8,
        customCreativeInstructions: 'Keep secrets opaque until ep 6',
      }),
    );
    expect(fields.genre).toBe('Mystery thriller');
    expect(fields.subgenres).toEqual(['Suspense']);
    expect(fields.additionalInstructions).toContain('Cliffhanger intensity: high');
    expect(fields.additionalInstructions).toContain('Keep secrets opaque until ep 6');
  });
});
