import { SERIES_PRODUCTION_STAGE_ORDER, isSeriesStageAutoEnabled } from '@ai-video/shared';

describe('SeriesOrchestrator stage gates', () => {
  it('starts production at MATERIALIZE so characters are projected before visuals', () => {
    expect(SERIES_PRODUCTION_STAGE_ORDER[0]).toBe('MATERIALIZE');
    expect(SERIES_PRODUCTION_STAGE_ORDER).toContain('VISUAL_INTELLIGENCE');
    expect(SERIES_PRODUCTION_STAGE_ORDER.indexOf('MATERIALIZE')).toBeLessThan(
      SERIES_PRODUCTION_STAGE_ORDER.indexOf('VISUAL_INTELLIGENCE'),
    );
  });

  it('requires render after speech so narration can be auto-approved', () => {
    const speech = SERIES_PRODUCTION_STAGE_ORDER.indexOf('SPEECH');
    const render = SERIES_PRODUCTION_STAGE_ORDER.indexOf('RENDER');
    expect(speech).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(speech);
  });

  it('does not auto-run a disabled stage when master production is on', () => {
    expect(isSeriesStageAutoEnabled(true, false)).toBe(false);
    expect(isSeriesStageAutoEnabled(true, true)).toBe(true);
    expect(isSeriesStageAutoEnabled(false, true)).toBe(false);
  });
});
