import { SeriesLaneStatus } from '@prisma/client';
import { SeriesLaneService } from './series-lane.service';

describe('SeriesLaneService.canLaneAcceptWork', () => {
  const service = Object.create(SeriesLaneService.prototype) as SeriesLaneService;

  it('requires enabled + ACTIVE', () => {
    expect(
      service.canLaneAcceptWork({ enabled: true, status: SeriesLaneStatus.ACTIVE }),
    ).toBe(true);
    expect(
      service.canLaneAcceptWork({ enabled: true, status: SeriesLaneStatus.PAUSED }),
    ).toBe(false);
    expect(
      service.canLaneAcceptWork({ enabled: true, status: SeriesLaneStatus.DISABLED }),
    ).toBe(false);
    expect(
      service.canLaneAcceptWork({ enabled: false, status: SeriesLaneStatus.ACTIVE }),
    ).toBe(false);
  });

  it('pausing morning does not imply evening cannot accept work', () => {
    const morning = { enabled: true, status: SeriesLaneStatus.PAUSED };
    const evening = { enabled: true, status: SeriesLaneStatus.ACTIVE };
    expect(service.canLaneAcceptWork(morning)).toBe(false);
    expect(service.canLaneAcceptWork(evening)).toBe(true);
  });
});
