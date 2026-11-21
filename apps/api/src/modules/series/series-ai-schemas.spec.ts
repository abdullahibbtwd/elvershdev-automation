import {
  createMockEpisodeScript,
  createMockMoviePremise,
  episodeScriptPlanSchema,
  movieArchitectBriefSchema,
  moviePremiseSchema,
} from '@ai-video/shared';

describe('Series AI Zod schemas', () => {
  it('accepts Movie Architect brief with required creative fields', () => {
    const parsed = movieArchitectBriefSchema.parse({
      genre: 'Cinematic drama',
      plannedEpisodeCount: 10,
      targetEpisodeDurationSeconds: 60,
      language: 'en',
      tone: 'Premium serialized drama',
      visualDirection: 'Mature cinematic 3D',
    });
    expect(parsed.plannedEpisodeCount).toBe(10);
  });

  it('rejects invalid episode counts', () => {
    expect(() =>
      movieArchitectBriefSchema.parse({
        genre: 'Drama',
        plannedEpisodeCount: 0,
        targetEpisodeDurationSeconds: 60,
        language: 'en',
        tone: 'Tone',
        visualDirection: 'Look',
      }),
    ).toThrow();
    expect(() =>
      movieArchitectBriefSchema.parse({
        genre: 'Drama',
        plannedEpisodeCount: 121,
        targetEpisodeDurationSeconds: 60,
        language: 'en',
        tone: 'Tone',
        visualDirection: 'Look',
      }),
    ).toThrow();
  });

  it('allows a single-episode short movie', () => {
    const parsed = movieArchitectBriefSchema.parse({
      genre: 'Drama',
      plannedEpisodeCount: 1,
      targetEpisodeDurationSeconds: 60,
      language: 'en',
      tone: 'Tone',
      visualDirection: 'Look',
    });
    expect(parsed.plannedEpisodeCount).toBe(1);
  });

  it('parses mock premise and episode script plans', () => {
    const brief = movieArchitectBriefSchema.parse({
      genre: 'Cinematic drama',
      plannedEpisodeCount: 10,
      targetEpisodeDurationSeconds: 60,
    });
    const premise = moviePremiseSchema.parse(createMockMoviePremise(brief));
    expect(premise.title.length).toBeGreaterThan(2);
    expect(premise.logline.length).toBeGreaterThan(10);

    const episode = episodeScriptPlanSchema.parse(
      createMockEpisodeScript({
        episodeNumber: 1,
        title: 'Opening',
        targetDurationSeconds: 60,
      }),
    );
    expect(episode.scenes.length).toBeGreaterThanOrEqual(2);
    expect(episode.memoryEvents.length).toBeGreaterThan(0);
  });
});
