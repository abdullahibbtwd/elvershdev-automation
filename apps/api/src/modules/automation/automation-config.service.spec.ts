import { AutomationRunMode } from '@prisma/client';
import { AutomationConfigService } from './automation-config.service';

describe('AutomationConfigService.canScheduleNewWork', () => {
  const service = Object.create(AutomationConfigService.prototype) as AutomationConfigService;

  it('allows only enabled + ENABLED mode', () => {
    expect(service.canScheduleNewWork({ enabled: true, runMode: AutomationRunMode.ENABLED })).toBe(
      true,
    );
    expect(service.canScheduleNewWork({ enabled: true, runMode: AutomationRunMode.PAUSED })).toBe(
      false,
    );
    expect(
      service.canScheduleNewWork({ enabled: true, runMode: AutomationRunMode.EMERGENCY_STOP }),
    ).toBe(false);
    expect(service.canScheduleNewWork({ enabled: false, runMode: AutomationRunMode.ENABLED })).toBe(
      false,
    );
  });
});
