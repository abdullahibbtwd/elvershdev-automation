import { SeriesLaneStatus } from '@prisma/client';
import { SeriesLaneService } from './series-lane.service';

describe('Series dual-lane isolation', () => {
  const service = Object.create(SeriesLaneService.prototype) as SeriesLaneService;

  it('pausing morning does not imply evening cannot accept work', () => {
    const morning = { enabled: true, status: SeriesLaneStatus.PAUSED };
    const evening = { enabled: true, status: SeriesLaneStatus.ACTIVE };
    expect(service.canLaneAcceptWork(morning)).toBe(false);
    expect(service.canLaneAcceptWork(evening)).toBe(true);
  });

  it('disabled lane cannot accept work even when ACTIVE status', () => {
    expect(
      service.canLaneAcceptWork({ enabled: false, status: SeriesLaneStatus.ACTIVE }),
    ).toBe(false);
  });
});
