import {
  countSpokenWords,
  createMockEpisodeScript,
  episodeScriptPlanSchema,
  SERIES_DEFAULTS,
} from '@ai-video/shared';

describe('Episode Director mock script', () => {
  it('produces a parseable script with scenes and continuity changes', () => {
    const plan = episodeScriptPlanSchema.parse(
      createMockEpisodeScript({
        episodeNumber: 1,
        title: 'Token 1',
        targetDurationSeconds: 60,
      }),
    );

    expect(plan.scenes.length).toBeGreaterThanOrEqual(2);
    expect(plan.hook.length).toBeGreaterThan(5);
    expect(plan.ending.length).toBeGreaterThan(5);
    expect(plan.memoryEvents.length).toBeGreaterThan(0);
    expect(plan.spokenWordCount).toBe(countSpokenWords(plan.narrationText));
  });

  it('targets approximately 110-135 words for a 60s episode without hard-failing', () => {
    const plan = createMockEpisodeScript({
      episodeNumber: 3,
      title: 'Token 3',
      targetDurationSeconds: 60,
    });
    expect(plan.spokenWordCount).toBeGreaterThanOrEqual(
      SERIES_DEFAULTS.spokenWordsPerSixtySecondsMin - 30,
    );
    expect(plan.spokenWordCount).toBeLessThanOrEqual(
      SERIES_DEFAULTS.spokenWordsPerSixtySecondsMax + 80,
    );
  });
});
