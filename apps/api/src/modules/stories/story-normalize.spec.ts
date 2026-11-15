import {
  generatedScenePlanSchema,
  generatedStorySchema,
  normalizeGeneratedScenePlanInput,
  normalizeGeneratedStoryInput,
} from '@ai-video/shared';

describe('normalizeGeneratedStoryInput', () => {
  it('maps alternate field names and flattens appearance objects', () => {
    const normalized = normalizeGeneratedStoryInput({
      title: 'The Signal',
      narrative: 'A keeper hears a pulse from the sea.',
      hook: 'The lamp flickered once.',
      voiceover: 'He stepped into the wind.',
      outro: 'Some signals answer back.',
      caption: 'A lighthouse mystery.',
      tags: ['#mystery', 'sea'],
      characters: [
        {
          name: 'Mara',
          appearance: {
            clothing: 'oilskin coat',
            age: '40s',
            hair: 'salt-streaked black',
            features: 'scar on left brow',
          },
        },
      ],
    });

    const parsed = generatedStorySchema.parse(normalized);
    expect(parsed.story).toContain('keeper');
    expect(parsed.openingHook).toContain('flickered');
    expect(parsed.narrationScript).toContain('wind');
    expect(parsed.closingMessage).toContain('signals');
    expect(parsed.characters[0]?.clothing).toContain('oilskin');
    expect(typeof parsed.characters[0]?.appearance).toBe('string');
  });
});

describe('normalizeGeneratedScenePlanInput', () => {
  it('flattens nested lighting/environment and fills missing scene fields', () => {
    const normalized = normalizeGeneratedScenePlanInput({
      duration: 30,
      shots: [
        {
          narration: 'He hears the pulse.',
          description: 'Lighthouse at dusk',
          lighting: { key: 'warm tungsten', fill: 'cool window light' },
          environment: { place: 'cliffside tower', weather: 'windy' },
        },
      ],
    });

    const parsed = generatedScenePlanSchema.parse(normalized);
    expect(parsed.totalDurationSeconds).toBe(30);
    expect(parsed.scenes[0]?.sceneNumber).toBe(1);
    expect(parsed.scenes[0]?.visualDescription).toContain('Lighthouse');
    expect(typeof parsed.scenes[0]?.lighting).toBe('string');
    expect(typeof parsed.scenes[0]?.environment).toBe('string');
    expect(parsed.scenes[0]?.imagePrompt.length).toBeGreaterThan(0);
  });
});
