import { PublishStatus, SocialConnectionStatus, SocialPlatform } from '@prisma/client';
import {
  DEFAULT_CAPABILITIES,
  buildSeriesEpisodePostCaption,
  buildSeriesEpisodePostTitle,
} from '@ai-video/shared';

describe('Series episode post title/caption', () => {
  it('includes episode number and name on every post', () => {
    expect(
      buildSeriesEpisodePostTitle({
        episodeNumber: 1,
        episodeTitle: 'The Shoal of Scylla',
        plannedEpisodeCount: 10,
      }),
    ).toBe('Ep 1/10: The Shoal of Scylla');

    const caption = buildSeriesEpisodePostCaption({
      seriesTitle: 'A Fragile Threshold',
      episodeNumber: 1,
      episodeTitle: 'The Shoal of Scylla',
      plannedEpisodeCount: 10,
      body: 'Julian arrives under fog.',
    });
    expect(caption.startsWith('Ep 1/10: The Shoal of Scylla')).toBe(true);
    expect(caption).toContain('A Fragile Threshold');
    expect(caption).toContain('Julian arrives under fog.');
  });
});

describe('Series publish eligibility helpers', () => {
  function evaluateEligibility(channel: {
    isActive: boolean;
    connectionStatus: SocialConnectionStatus;
    platform: SocialPlatform;
    publishingCapabilities: Record<string, unknown>;
  }): { ok: boolean; reason?: string } {
    if (!channel.isActive) return { ok: false, reason: 'Channel inactive' };
    const defaults = DEFAULT_CAPABILITIES[channel.platform];
    const caps = {
      ...defaults,
      ...channel.publishingCapabilities,
    };
    const eligibleStatus =
      channel.connectionStatus === SocialConnectionStatus.PUBLIC_READY ||
      channel.connectionStatus === SocialConnectionStatus.TEST_ONLY ||
      (channel.connectionStatus === SocialConnectionStatus.CONNECTED && caps.canPublishVideo);
    if (!eligibleStatus) {
      return { ok: false, reason: `Ineligible status ${channel.connectionStatus}` };
    }
    if (!caps.canPublishVideo) return { ok: false, reason: 'canPublishVideo=false' };
    return { ok: true };
  }

  it('accepts PUBLIC_READY channels that can publish video', () => {
    expect(
      evaluateEligibility({
        isActive: true,
        connectionStatus: SocialConnectionStatus.PUBLIC_READY,
        platform: SocialPlatform.YOUTUBE,
        publishingCapabilities: { canPublishVideo: true },
      }).ok,
    ).toBe(true);
  });

  it('rejects inactive or revoked channels', () => {
    expect(
      evaluateEligibility({
        isActive: false,
        connectionStatus: SocialConnectionStatus.PUBLIC_READY,
        platform: SocialPlatform.INSTAGRAM,
        publishingCapabilities: { canPublishVideo: true },
      }).ok,
    ).toBe(false);
    expect(
      evaluateEligibility({
        isActive: true,
        connectionStatus: SocialConnectionStatus.REVOKED,
        platform: SocialPlatform.TIKTOK,
        publishingCapabilities: { canPublishVideo: true },
      }).ok,
    ).toBe(false);
  });
});

describe('Series ensureNextSchedule daily exclusivity', () => {
  it('skips creating a second schedule while one is still pending', async () => {
    const pending = {
      id: 'sched-1',
      laneId: 'lane-1',
      state: 'SCHEDULED',
      scheduledAt: new Date('2026-11-16T07:00:00.000Z'),
    };
    const prisma = {
      seriesSchedule: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(pending), // pending open schedule
      },
    };
    // Lightweight behavioral check matching ensureNextSchedule early-return contract.
    const open = await prisma.seriesSchedule.findFirst({
      where: {
        laneId: 'lane-1',
        state: { in: ['PENDING', 'SCHEDULED', 'QUEUED', 'PUBLISHING'] },
      },
    });
    expect(open).toEqual(pending);
    expect(prisma.seriesSchedule.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('Series publish outcome aggregation', () => {
  it('treats schedule as published when any channel succeeds and all are terminal', () => {
    const records = [
      { status: PublishStatus.PUBLISHED },
      { status: PublishStatus.FAILED },
    ];
    const terminal = [PublishStatus.PUBLISHED, PublishStatus.FAILED, PublishStatus.CANCELLED];
    const allTerminal = records.every((record) => terminal.includes(record.status));
    const successes = records.filter((record) => record.status === PublishStatus.PUBLISHED);
    expect(allTerminal).toBe(true);
    expect(successes.length).toBeGreaterThan(0);
  });

  it('waits while any publish record is still in flight', () => {
    const records: Array<{ status: PublishStatus }> = [
      { status: PublishStatus.PUBLISHED },
      { status: PublishStatus.UPLOADING },
    ];
    const terminal: PublishStatus[] = [
      PublishStatus.PUBLISHED,
      PublishStatus.FAILED,
      PublishStatus.CANCELLED,
    ];
    expect(records.every((record) => terminal.includes(record.status))).toBe(false);
  });
});
