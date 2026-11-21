import {
  SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER,
  SERIES_PRODUCTION_STAGE_ORDER,
  isSeriesStageAutoEnabled,
  nextSeriesDialogueProductionStage,
} from '@ai-video/shared';

describe('SeriesOrchestrator stage gates', () => {
  it('uses Grok dialogue stages for all Series lanes (no fal VISUAL_INTELLIGENCE)', () => {
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).toEqual([
      'MATERIALIZE',
      'CLIP_GENERATION',
      'ASSEMBLY',
      'DONE',
    ]);
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).not.toContain('VISUAL_INTELLIGENCE');
    expect(nextSeriesDialogueProductionStage('VISUAL_INTELLIGENCE')).toBe('CLIP_GENERATION');
  });

  it('keeps legacy stage list only for old run-row compatibility', () => {
    expect(SERIES_PRODUCTION_STAGE_ORDER).toContain('VISUAL_INTELLIGENCE');
  });

  it('does not auto-run a disabled stage when master production is on', () => {
    expect(isSeriesStageAutoEnabled(true, false)).toBe(false);
    expect(isSeriesStageAutoEnabled(true, true)).toBe(true);
    expect(isSeriesStageAutoEnabled(false, true)).toBe(false);
  });
});
