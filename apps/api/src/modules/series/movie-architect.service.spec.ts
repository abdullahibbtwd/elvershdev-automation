import {
  createMockEpisodeOutlines,
  createMockMovieArc,
  createMockMovieCharacters,
  createMockMoviePremise,
  movieArchitectBriefSchema,
  movieArcPlanSchema,
  movieCharactersPlanSchema,
  moviePremiseSchema,
} from '@ai-video/shared';

describe('Movie Architect mock plan coherence', () => {
  const brief = movieArchitectBriefSchema.parse({
    genre: 'Cinematic drama',
    plannedEpisodeCount: 10,
    targetEpisodeDurationSeconds: 60,
  });

  it('creates a complete ending before episode outlines exist', () => {
    const premise = moviePremiseSchema.parse(createMockMoviePremise(brief));
    const characters = movieCharactersPlanSchema.parse(createMockMovieCharacters(brief));
    const arc = movieArcPlanSchema.parse(createMockMovieArc(brief, premise));

    expect(arc.ending.trim().length).toBeGreaterThan(20);
    expect(characters.characters.length).toBeGreaterThanOrEqual(2);
    expect(characters.characters.some((c) => c.role === 'PROTAGONIST')).toBe(true);

    const outlines = createMockEpisodeOutlines(brief, 1, 10);
    expect(outlines).toHaveLength(10);
    expect(outlines[0].episodeNumber).toBe(1);
    expect(outlines[9].episodeNumber).toBe(10);
    expect(outlines[9].title.toLowerCase()).toContain('unlock');
  });

  it('keeps episode numbering unique and contiguous for multi-batch ranges', () => {
    const batch1 = createMockEpisodeOutlines(brief, 1, 5);
    const batch2 = createMockEpisodeOutlines(brief, 6, 10);
    const all = [...batch1, ...batch2];
    const numbers = all.map((e) => e.episodeNumber);
    expect(new Set(numbers).size).toBe(10);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
