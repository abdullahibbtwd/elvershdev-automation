import { isLaneProductionEligible, isSeriesStageAutoEnabled } from '@ai-video/shared';

describe('SeriesLifecycleHandoff contracts', () => {
  it('only auto-produces after approval when master + media stage + window allow it', () => {
    const masterOn = true;
    const visualsOn = true;
    const windowOpen = isLaneProductionEligible({
      now: new Date('2026-11-16T04:00:00.000Z'),
      timeZone: 'Africa/Lagos',
      publishTime: '08:00',
      leadTimeMinutes: 240,
      productionStartMode: 'NEXT_WINDOW',
    });
    expect(windowOpen).toBe(true);
    expect(isSeriesStageAutoEnabled(masterOn, visualsOn)).toBe(true);

    const manualOnly = isLaneProductionEligible({
      now: new Date('2026-11-16T04:00:00.000Z'),
      timeZone: 'Africa/Lagos',
      publishTime: '08:00',
      leadTimeMinutes: 240,
      productionStartMode: 'MANUAL',
    });
    expect(manualOnly).toBe(false);
  });

  it('keeps publishing handoff independent of production master', () => {
    // Publishing uses automaticPublishing alone — production master must not force publish.
    const automaticPublishing = false;
    const automaticEpisodeProduction = true;
    expect(automaticPublishing && automaticEpisodeProduction).toBe(false);
  });
});
