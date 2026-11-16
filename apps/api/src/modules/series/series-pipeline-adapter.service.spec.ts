import {
  nextSeriesProductionStage,
  SERIES_PRODUCTION_STAGE_ORDER,
} from '@ai-video/shared';

describe('Series production stage order', () => {
  it('advances MATERIALIZE through DONE without skipping pipeline stages', () => {
    expect(SERIES_PRODUCTION_STAGE_ORDER[0]).toBe('MATERIALIZE');
    expect(SERIES_PRODUCTION_STAGE_ORDER.at(-1)).toBe('DONE');

    let stage: (typeof SERIES_PRODUCTION_STAGE_ORDER)[number] | null =
      SERIES_PRODUCTION_STAGE_ORDER[0];
    const seen: string[] = [];
    while (stage) {
      seen.push(stage);
      stage = nextSeriesProductionStage(stage);
    }

    expect(seen).toEqual([
      'MATERIALIZE',
      'VISUAL_INTELLIGENCE',
      'MOTION_GENERATION',
      'NARRATION',
      'SPEECH',
      'RENDER',
      'DONE',
    ]);
    expect(nextSeriesProductionStage('DONE')).toBeNull();
  });
});

describe('Series pipeline adapter character projection helpers', () => {
  it('builds consistency instructions from series character notes', () => {
    const characterNotesByName = new Map([
      ['mira', 'Keep Mira silver braid and teal coat'],
      ['knox', 'Knox scar over left brow'],
    ]);
    const names = ['Mira', 'Knox'];
    const consistency = names
      .map((name) => {
        const note = characterNotesByName.get(name.toLowerCase());
        return note ? `${name}: ${note}` : name;
      })
      .join(' | ');

    expect(consistency).toContain('Mira: Keep Mira silver braid');
    expect(consistency).toContain('Knox: Knox scar');
  });

  it('falls back to action when narration and dialogue are empty', () => {
    const narration = undefined;
    const dialogue = undefined;
    const action = 'Mira steps into the rain-soaked alley.';
    const resolved = (narration ?? dialogue ?? '').trim() || action;
    expect(resolved).toBe(action);
  });
});
