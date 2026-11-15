import { generateUniqueContentIdeas } from '@ai-video/shared';

describe('daily generation target configurability', () => {
  it('supports configurable targets including default of two', () => {
    const make = (count: number) =>
      generateUniqueContentIdeas({
        count,
        niche: 'Business',
        audience: 'Creators',
        categories: ['Narrative'],
        genres: ['Cinematic storytelling'],
        themes: ['growth'],
        tone: 'Bold',
        exclusions: [],
        daySalt: `target-${count}`,
        recent: [],
      });

    expect(make(2)).toHaveLength(2);
    expect(make(3)).toHaveLength(3);
    expect(make(1)).toHaveLength(1);
  });
});
