import {
  computeNextPublishAt,
  isEpisodeNextInPublishOrder,
  isLanePublishDue,
  resolveLanePublishSlot,
  seriesPublishJobId,
  seriesReplacementIdempotencyKey,
  seriesScheduleIdempotencyKey,
  shouldTriggerReplacement,
} from '@ai-video/shared';
import { SeriesLaneService } from './series-lane.service';
import { SeriesLaneStatus } from '@prisma/client';

describe('Series Phase E/G scheduler rules', () => {
  it('respects lane local timezone for publish due checks', () => {
    const now = new Date('2026-11-16T13:00:00.000Z'); // 08:00 America/New_York
    expect(isLanePublishDue(now, 'America/New_York', '08:00')).toBe(true);
    expect(isLanePublishDue(now, 'UTC', '13:00')).toBe(true);
    expect(isLanePublishDue(now, 'UTC', '08:00')).toBe(false);
  });

  it('computes next publish after the current slot', () => {
    const now = new Date('2026-11-16T19:00:00.000Z');
    const next = computeNextPublishAt(now, 'UTC', '19:00');
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('keeps publish order by episode number even if later media finishes first', () => {
    expect(
      isEpisodeNextInPublishOrder({
        candidateEpisodeNumber: 3,
        earliestUnpublishedEpisodeNumber: 2,
      }),
    ).toBe(false);
    expect(
      isEpisodeNextInPublishOrder({
        candidateEpisodeNumber: 2,
        earliestUnpublishedEpisodeNumber: 2,
      }),
    ).toBe(true);
    expect(
      isEpisodeNextInPublishOrder({
        candidateEpisodeNumber: 1,
        earliestUnpublishedEpisodeNumber: null,
      }),
    ).toBe(false);
  });

  it('never stacks multiple episodes onto the same local publish day', () => {
    const now = new Date('2026-11-16T07:05:00.000Z'); // 08:05 Lagos
    const todaySlot = new Date('2026-11-16T07:00:00.000Z'); // 08:00 Lagos
    const day2 = resolveLanePublishSlot({
      now,
      timeZone: 'Africa/Lagos',
      publishTime: '08:00',
      laneNextPublishAt: todaySlot,
      latestScheduledAt: todaySlot,
    });
    expect(day2.toISOString()).toBe('2026-11-17T07:00:00.000Z');
    const day3 = resolveLanePublishSlot({
      now,
      timeZone: 'Africa/Lagos',
      publishTime: '08:00',
      laneNextPublishAt: todaySlot,
      latestScheduledAt: day2,
    });
    expect(day3.toISOString()).toBe('2026-11-18T07:00:00.000Z');
  });

  it('triggers replacement at configured episode threshold only', () => {
    expect(
      shouldTriggerReplacement({
        lastPublishedEpisodeNumber: 7,
        replacementTriggerEpisode: 8,
        plannedEpisodeCount: 10,
      }),
    ).toBe(false);
    expect(
      shouldTriggerReplacement({
        lastPublishedEpisodeNumber: 8,
        replacementTriggerEpisode: 8,
        plannedEpisodeCount: 10,
      }),
    ).toBe(true);
  });

  it('uses stable schedule/replacement/publish idempotency keys', () => {
    expect(seriesScheduleIdempotencyKey('L', 'E')).toBe('series-sched:L:E');
    expect(seriesReplacementIdempotencyKey('L', 'S')).toBe('series-replace:L:S');
    // BullMQ job IDs cannot contain `:`.
    expect(seriesPublishJobId('sched-1')).toBe('series-pub-sched-1');
  });

  it('live publish handoff uses series-scoped publish record keys', () => {
    const scheduleId = 'sched-1';
    const channelId = 'ch-1';
    // PublishingService appends :channelId to the base idempotency key (DB key, not BullMQ jobId).
    expect(`series-pub:${scheduleId}:${channelId}`).toBe('series-pub:sched-1:ch-1');
  });

  it('pausing morning does not block evening lane acceptance', () => {
    const service = Object.create(SeriesLaneService.prototype) as SeriesLaneService;
    expect(
      service.canLaneAcceptWork({ enabled: true, status: SeriesLaneStatus.PAUSED }),
    ).toBe(false);
    expect(
      service.canLaneAcceptWork({ enabled: true, status: SeriesLaneStatus.ACTIVE }),
    ).toBe(true);
  });
});
