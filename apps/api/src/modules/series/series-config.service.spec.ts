import { AutomationRunMode } from '@prisma/client';
import { AUTOMATION_DEFAULTS, SERIES_DEFAULTS } from '@ai-video/shared';
import { SeriesConfigService } from './series-config.service';

describe('SeriesConfigService.canScheduleNewWork', () => {
  const service = Object.create(SeriesConfigService.prototype) as SeriesConfigService;

  it('allows only seriesStudioEnabled + ENABLED mode', () => {
    expect(
      service.canScheduleNewWork({
        seriesStudioEnabled: true,
        runMode: AutomationRunMode.ENABLED,
      }),
    ).toBe(true);
    expect(
      service.canScheduleNewWork({
        seriesStudioEnabled: true,
        runMode: AutomationRunMode.PAUSED,
      }),
    ).toBe(false);
    expect(
      service.canScheduleNewWork({
        seriesStudioEnabled: true,
        runMode: AutomationRunMode.EMERGENCY_STOP,
      }),
    ).toBe(false);
    expect(
      service.canScheduleNewWork({
        seriesStudioEnabled: false,
        runMode: AutomationRunMode.ENABLED,
      }),
    ).toBe(false);
  });
});

describe('Series Studio isolation from standalone automation', () => {
  it('keeps Series defaults independent of AutomationConfig defaults', () => {
    expect(SERIES_DEFAULTS.morningPublishTime).toBe('08:00');
    expect(SERIES_DEFAULTS.eveningPublishTime).toBe('19:00');
    expect(SERIES_DEFAULTS.plannedEpisodeCount).toBe(10);
    expect(SERIES_DEFAULTS.replacementTriggerEpisode).toBe(8);
    expect(SERIES_DEFAULTS.automaticReplacementApproval).toBe(false);
    expect(SERIES_DEFAULTS.maxConcurrentEpisodeProduction).toBe(1);

    // Standalone automation remains its own surface.
    expect(AUTOMATION_DEFAULTS).not.toHaveProperty('seriesStudioEnabled');
    expect(AUTOMATION_DEFAULTS).not.toHaveProperty('morningPublishTime');
    expect(AUTOMATION_DEFAULTS.maxConcurrentGeneration).toBe(2);
    expect(SERIES_DEFAULTS.maxConcurrentEpisodeProduction).not.toBe(
      AUTOMATION_DEFAULTS.maxConcurrentGeneration,
    );
  });
});
