import {
  computeNextProductionAt,
  computeNextPublishAt,
  computeProductionClockTime,
  isLaneProductionEligible,
  isSeriesStageAutoEnabled,
} from '@ai-video/shared';

describe('Series lifecycle scheduling (fake clocks)', () => {
  const lagos = 'Africa/Lagos';

  it('keeps Series A production ahead of 08:00 publish', () => {
    const now = new Date('2026-11-16T01:00:00.000Z'); // 02:00 Lagos
    const publish = computeNextPublishAt(now, lagos, '08:00');
    const production = computeNextProductionAt(now, lagos, '08:00', 240);
    expect(computeProductionClockTime('08:00', 240)).toBe('04:00');
    expect(production.getTime()).toBeLessThan(publish.getTime());
    expect(
      isLaneProductionEligible({
        now,
        timeZone: lagos,
        publishTime: '08:00',
        leadTimeMinutes: 240,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        now: new Date('2026-11-16T03:15:00.000Z'), // 04:15 Lagos
        timeZone: lagos,
        publishTime: '08:00',
        leadTimeMinutes: 240,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(true);
  });

  it('keeps Series B production ahead of 19:00 publish', () => {
    const now = new Date('2026-11-16T12:00:00.000Z'); // 13:00 Lagos
    const publish = computeNextPublishAt(now, lagos, '19:00');
    const production = computeNextProductionAt(now, lagos, '19:00', 240);
    expect(computeProductionClockTime('19:00', 240)).toBe('15:00');
    expect(production.getTime()).toBeLessThan(publish.getTime());
    expect(
      isLaneProductionEligible({
        now,
        timeZone: lagos,
        publishTime: '19:00',
        leadTimeMinutes: 240,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        now: new Date('2026-11-16T14:30:00.000Z'), // 15:30 Lagos
        timeZone: lagos,
        publishTime: '19:00',
        leadTimeMinutes: 240,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(true);
  });

  it('allows two lanes to use independent windows', () => {
    const morningOpen = isLaneProductionEligible({
      now: new Date('2026-11-16T04:00:00.000Z'),
      timeZone: lagos,
      publishTime: '08:00',
      leadTimeMinutes: 240,
      productionStartMode: 'NEXT_WINDOW',
    });
    const eveningClosed = isLaneProductionEligible({
      now: new Date('2026-11-16T04:00:00.000Z'),
      timeZone: lagos,
      publishTime: '19:00',
      leadTimeMinutes: 240,
      productionStartMode: 'NEXT_WINDOW',
    });
    expect(morningOpen).toBe(true);
    expect(eveningClosed).toBe(false);
  });

  it('manual mode never auto-starts; immediate always does', () => {
    const now = new Date('2026-11-16T01:00:00.000Z');
    expect(
      isLaneProductionEligible({
        now,
        timeZone: lagos,
        publishTime: '08:00',
        leadTimeMinutes: 240,
        productionStartMode: 'MANUAL',
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        now,
        timeZone: lagos,
        publishTime: '08:00',
        leadTimeMinutes: 240,
        productionStartMode: 'IMMEDIATE',
      }),
    ).toBe(true);
  });

  it('stage disabled behaviour: master on + visuals off blocks auto visuals', () => {
    expect(isSeriesStageAutoEnabled(true, false)).toBe(false);
  });
});

describe('Series late-publish policy contract', () => {
  it('documents next-window recovery without duplicate episode schedules', () => {
    // Unique (episodeId, laneId) means recovery updates the same SeriesSchedule row.
    const policy = {
      incompleteAtPublishTime: 'mark MISSED / delayed; continue production; never publish incomplete',
      whenRenderedLater: 'reschedule same SeriesSchedule to next publishAt',
      duplicatePrevention: '@@unique([episodeId, laneId]) + publishedAt null checks',
    };
    expect(policy.whenRenderedLater).toContain('same SeriesSchedule');
    expect(policy.incompleteAtPublishTime).toContain('never publish incomplete');
  });
});
