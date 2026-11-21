import {
  creativeSettingsToBriefFields,
  isDialogueDrivenCreative,
  mergeSeriesCreativeSettings,
  parseSeriesCreativeSettings,
  SERIES_DIALOGUE_CREATIVE_DEFAULTS,
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
        storyDurationSeconds: 600,
        maxClipDurationSeconds: 15,
        productionFormat: 'episodic',
      }),
    );
    expect(fields.genre).toBe('Mystery thriller');
    expect(fields.subgenres).toEqual(['Suspense']);
    expect(fields.plannedEpisodeCount).toBe(8);
    expect(fields.targetStoryDurationSeconds).toBe(600);
    expect(fields.maxClipDurationSeconds).toBe(15);
    expect(fields.additionalInstructions).toContain('Cliffhanger intensity: high');
    expect(fields.additionalInstructions).toContain('Complete story/movie duration');
  });

  it('keeps theme within Movie Architect max when many themes are selected', () => {
    const many = [
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
    ];
    const fields = creativeSettingsToBriefFields(
      seriesCreativeSettingsSchema.parse({ themes: many }),
    );
    expect(fields.theme!.length).toBeLessThanOrEqual(300);
    expect(fields.additionalInstructions).toContain('Themes (full):');
  });

  it('treats storyConcept as soft inspiration and keeps theme selection-driven', () => {
    const fields = creativeSettingsToBriefFields(
      seriesCreativeSettingsSchema.parse({
        genres: ['Family drama'],
        themes: ['Sibling rivalry', 'Favouritism'],
        storyConcept: 'A young boy is mistreated at breakfast.',
      }),
    );
    expect(fields.theme).toBe('Sibling rivalry; Favouritism');
    expect(fields.theme).not.toContain('mistreated');
    expect(fields.additionalInstructions).toContain('Optional inspiration seed');
    expect(fields.additionalInstructions).toMatch(/original.*emotionally engaging|invent an original/i);
  });

  it('defaults to dialogue-driven; narration only when explicitly disabled', () => {
    expect(isDialogueDrivenCreative(null)).toBe(false);
    expect(isDialogueDrivenCreative(parseSeriesCreativeSettings({}))).toBe(true);
    expect(
      isDialogueDrivenCreative(
        parseSeriesCreativeSettings({ dialogueDrivenStorytelling: false }),
      ),
    ).toBe(false);
    expect(
      isDialogueDrivenCreative(
        parseSeriesCreativeSettings({ dialogueDrivenStorytelling: true }),
      ),
    ).toBe(true);
    expect(
      isDialogueDrivenCreative(
        parseSeriesCreativeSettings(SERIES_DIALOGUE_CREATIVE_DEFAULTS),
      ),
    ).toBe(true);
  });
});
