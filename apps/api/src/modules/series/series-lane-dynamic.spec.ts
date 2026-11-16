import { SeriesLaneStatus, SeriesLaneType } from '@prisma/client';
import { SeriesLaneService } from './series-lane.service';

describe('SeriesLaneService dynamic lanes (unit)', () => {
  const service = Object.create(SeriesLaneService.prototype) as SeriesLaneService;

  it('accepts work independently per lane', () => {
    const morning = { enabled: true, status: SeriesLaneStatus.PAUSED };
    const evening = { enabled: true, status: SeriesLaneStatus.ACTIVE };
    const custom = { enabled: true, status: SeriesLaneStatus.ACTIVE };
    expect(service.canLaneAcceptWork(morning)).toBe(false);
    expect(service.canLaneAcceptWork(evening)).toBe(true);
    expect(service.canLaneAcceptWork(custom)).toBe(true);
  });

  it('gates morning/evening by config flags but not CUSTOM', () => {
    const config = { morningLaneEnabled: false, eveningLaneEnabled: true };
    expect(
      service.isLaneConfigEnabled(
        { laneType: SeriesLaneType.MORNING, enabled: true },
        config,
      ),
    ).toBe(false);
    expect(
      service.isLaneConfigEnabled(
        { laneType: SeriesLaneType.EVENING, enabled: true },
        config,
      ),
    ).toBe(true);
    expect(
      service.isLaneConfigEnabled(
        { laneType: SeriesLaneType.CUSTOM, enabled: true },
        config,
      ),
    ).toBe(true);
  });

  it('rejects deleted lanes for work', () => {
    expect(
      service.canLaneAcceptWork({
        enabled: true,
        status: SeriesLaneStatus.ACTIVE,
        deletedAt: new Date(),
      }),
    ).toBe(false);
  });
});
