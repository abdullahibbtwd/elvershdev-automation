import {
  bullMqJobId,
  computeNextProductionAt,
  computeNextPublishAt,
  computeProductionClockTime,
  isLaneProductionEligible,
  isLanePublishDue,
  isSeriesStageAutoEnabled,
  seriesMaintenanceJobId,
  seriesPublishJobId,
  seriesReplacementIdempotencyKey,
  seriesScheduleIdempotencyKey,
  shouldTriggerReplacement,
  utcMinuteKey,
} from './scheduler';

describe('series scheduler helpers', () => {
  it('detects publish due in lane timezone', () => {
    // 2026-11-16 08:00 America/New_York = 13:00 UTC (EST)
    const now = new Date('2026-11-16T13:00:00.000Z');
    expect(isLanePublishDue(now, 'America/New_York', '08:00')).toBe(true);
    expect(isLanePublishDue(now, 'America/New_York', '08:01')).toBe(false);
    expect(isLanePublishDue(now, 'UTC', '08:00')).toBe(false);
  });

  it('computes a future nextPublishAt', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    const next = computeNextPublishAt(now, 'UTC', '19:00');
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.toISOString()).toContain('T19:00:00');
  });

  it('computes production clock from publish minus lead time', () => {
    expect(computeProductionClockTime('08:00', 240)).toBe('04:00');
    expect(computeProductionClockTime('19:00', 240)).toBe('15:00');
    expect(computeProductionClockTime('01:00', 120)).toBe('23:00');
    expect(computeProductionClockTime('08:00', 240, '05:30')).toBe('05:30');
  });

  it('computes next production before publish (Africa/Lagos UTC+1)', () => {
    // 2026-11-16 02:00 Lagos = 01:00 UTC; next publish 08:00 Lagos; lead 4h → 04:00 Lagos
    const now = new Date('2026-11-16T01:00:00.000Z');
    const nextProd = computeNextProductionAt(now, 'Africa/Lagos', '08:00', 240);
    expect(nextProd.toISOString()).toBe('2026-11-16T03:00:00.000Z'); // 04:00 Lagos
    const nextPub = computeNextPublishAt(now, 'Africa/Lagos', '08:00');
    expect(nextPub.toISOString()).toBe('2026-11-16T07:00:00.000Z'); // 08:00 Lagos
    expect(nextProd.getTime()).toBeLessThan(nextPub.getTime());
  });

  it('gates production eligibility by start mode (fake clocks)', () => {
    const beforeWindow = new Date('2026-11-16T02:00:00.000Z'); // 03:00 Lagos
    const inWindow = new Date('2026-11-16T03:30:00.000Z'); // 04:30 Lagos
    const base = {
      timeZone: 'Africa/Lagos',
      publishTime: '08:00',
      leadTimeMinutes: 240,
    };

    expect(
      isLaneProductionEligible({
        ...base,
        now: beforeWindow,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        ...base,
        now: inWindow,
        productionStartMode: 'NEXT_WINDOW',
      }),
    ).toBe(true);
    expect(
      isLaneProductionEligible({
        ...base,
        now: beforeWindow,
        productionStartMode: 'IMMEDIATE',
      }),
    ).toBe(true);
    expect(
      isLaneProductionEligible({
        ...base,
        now: inWindow,
        productionStartMode: 'MANUAL',
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        ...base,
        now: beforeWindow,
        productionStartMode: 'CUSTOM',
        customProductionStartAt: new Date('2026-11-16T05:00:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isLaneProductionEligible({
        ...base,
        now: new Date('2026-11-16T05:00:00.000Z'),
        productionStartMode: 'CUSTOM',
        customProductionStartAt: new Date('2026-11-16T05:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('requires master + stage for auto stage enablement', () => {
    expect(isSeriesStageAutoEnabled(true, true)).toBe(true);
    expect(isSeriesStageAutoEnabled(true, false)).toBe(false);
    expect(isSeriesStageAutoEnabled(false, true)).toBe(false);
  });

  it('builds stable idempotency keys', () => {
    expect(seriesScheduleIdempotencyKey('lane', 'ep')).toBe('series-sched:lane:ep');
    expect(seriesReplacementIdempotencyKey('lane', 'series')).toBe(
      'series-replace:lane:series',
    );
  });

  it('builds BullMQ-safe job ids without colons', () => {
    expect(bullMqJobId('series-ep-auto', 'abc')).toBe('series-ep-auto-abc');
    expect(seriesPublishJobId('sched-1')).toBe('series-pub-sched-1');
    expect(
      seriesMaintenanceJobId(
        'recover_stuck',
        utcMinuteKey(new Date('2026-11-16T16:20:00.000Z')),
      ),
    ).toBe('series-maint-recover_stuck-2026-11-16T16-20');
    expect(seriesPublishJobId('sched-1')).not.toContain(':');
  });

  it('triggers replacement from episode threshold', () => {
    expect(
      shouldTriggerReplacement({
        lastPublishedEpisodeNumber: 8,
        replacementTriggerEpisode: 8,
        plannedEpisodeCount: 10,
      }),
    ).toBe(true);
  });
});
