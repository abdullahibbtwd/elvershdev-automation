import {
  fingerprintIdea,
  generateUniqueContentIdeas,
  isNearDuplicateIdea,
} from '@ai-video/shared';

describe('content idea generation', () => {
  it('generates the requested number of unique ideas', () => {
    const ideas = generateUniqueContentIdeas({
      count: 2,
      niche: 'Motivation',
      audience: 'Founders',
      categories: ['Narrative', 'Motivation'],
      genres: ['Cinematic storytelling'],
      themes: ['resilience', 'ambition'],
      tone: 'Inspirational',
      exclusions: [],
      daySalt: '2026-03-14:user',
      recent: [],
    });
    expect(ideas).toHaveLength(2);
    expect(ideas[0].title).not.toEqual(ideas[1].title);
    expect(fingerprintIdea(ideas[0])).not.toEqual(fingerprintIdea(ideas[1]));
  });

  it('avoids near-duplicate and excluded topics', () => {
    const recent = [
      {
        title: 'The quiet decision that reshaped a Motivation journey (user-1)',
        summary: 'A cinematic story about someone in Founders who makes one overlooked choice',
        fingerprint: 'x',
      },
    ];
    const ideas = generateUniqueContentIdeas({
      count: 2,
      niche: 'Motivation',
      audience: 'Founders',
      categories: ['Narrative'],
      genres: ['Cinematic storytelling'],
      themes: ['resilience'],
      tone: 'Inspirational',
      exclusions: ['violence'],
      daySalt: '2026-03-14:abc',
      recent,
    });
    expect(ideas.length).toBe(2);
    for (const idea of ideas) {
      expect(isNearDuplicateIdea(idea, recent)).toBe(false);
      expect(idea.title.toLowerCase()).not.toContain('violence');
    }
  });
});
