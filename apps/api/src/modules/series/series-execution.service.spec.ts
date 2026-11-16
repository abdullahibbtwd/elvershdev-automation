import {
  SeriesApprovalStatus,
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesExecutionAction,
  SeriesLaneStatus,
} from '@prisma/client';
import { SeriesExecutionService } from './series-execution.service';

describe('SeriesExecutionService.resolveNextAction (unit, mocked deps)', () => {
  function buildService(overrides: {
    lane?: Record<string, unknown>;
    series?: Record<string, unknown> | null;
  }) {
    const lane = {
      id: 'lane-1',
      userId: 'user-1',
      enabled: true,
      status: SeriesLaneStatus.ACTIVE,
      activeSeriesId: overrides.lane?.activeSeriesId ?? null,
      deletedAt: null,
      ...overrides.lane,
    };

    const prisma = {
      storySeries: {
        findFirst: jest.fn(async () => overrides.series),
      },
      setting: {
        findUnique: jest.fn(async () => null),
      },
      seriesExecution: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      seriesCharacter: { count: jest.fn() },
      seriesEpisode: { findFirst: jest.fn() },
    };

    const lanes = {
      getOwned: jest.fn(async () => lane),
      canLaneAcceptWork: jest.fn(() => true),
      isLaneConfigEnabled: jest.fn(() => true),
      list: jest.fn(),
    };

    const service = new SeriesExecutionService(
      prisma as never,
      {} as never,
      lanes as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, lanes };
  }

  it('plans a movie when lane has no active series', async () => {
    const { service } = buildService({ lane: { activeSeriesId: null }, series: null });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.PLAN_MOVIE);
  });

  it('awaits series approval instead of bypassing', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.PENDING,
        characters: [{ id: 'c1' }],
        episodes: [],
        status: 'READY',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.AWAIT_SERIES_APPROVAL);
  });

  it('FULLY_AUTONOMOUS does not wait for movie approval', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.PENDING,
        characters: [{ id: 'c1' }],
        episodes: [
          {
            id: 'ep-1',
            episodeNumber: 1,
            status: SeriesEpisodeStatus.PLANNED,
            script: null,
            productionState: SeriesEpisodeProductionState.IDLE,
            approvalStatus: SeriesApprovalStatus.PENDING,
          },
        ],
        status: 'READY',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      movieApprovalRequired: true,
      automaticPublishing: false,
      autonomyMode: 'FULLY_AUTONOMOUS',
      effectiveMovieApprovalRequired: false,
      effectiveEpisodeApprovalRequired: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.PLAN_EPISODE);
  });

  it('FULLY_AUTONOMOUS does not wait for episode approval', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.APPROVED,
        characters: [{ id: 'c1' }],
        episodes: [
          {
            id: 'ep-1',
            episodeNumber: 1,
            status: SeriesEpisodeStatus.SCRIPT_READY,
            script: 'script',
            productionState: SeriesEpisodeProductionState.IDLE,
            approvalStatus: SeriesApprovalStatus.PENDING,
          },
        ],
        status: 'ACTIVE',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
      autonomyMode: 'FULLY_AUTONOMOUS',
      effectiveEpisodeApprovalRequired: false,
      effectiveMovieApprovalRequired: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.PRODUCE_EPISODE);
    expect(result.episodeId).toBe('ep-1');
  });

  it('plans the next episode for an approved movie', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.APPROVED,
        characters: [{ id: 'c1' }],
        episodes: [
          {
            id: 'ep-1',
            episodeNumber: 1,
            status: SeriesEpisodeStatus.PLANNED,
            script: null,
            productionState: SeriesEpisodeProductionState.IDLE,
            approvalStatus: SeriesApprovalStatus.PENDING,
          },
        ],
        status: 'ACTIVE',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.PLAN_EPISODE);
    expect(result.episodeId).toBe('ep-1');
  });

  it('does not bypass episode approval', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.APPROVED,
        characters: [{ id: 'c1' }],
        episodes: [
          {
            id: 'ep-1',
            episodeNumber: 1,
            status: SeriesEpisodeStatus.SCRIPT_READY,
            script: 'script',
            productionState: SeriesEpisodeProductionState.IDLE,
            approvalStatus: SeriesApprovalStatus.PENDING,
          },
        ],
        status: 'ACTIVE',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.AWAIT_EPISODE_APPROVAL);
  });

  it('reports already processing episodes as idle report', async () => {
    const { service } = buildService({
      lane: { activeSeriesId: 'series-1' },
      series: {
        id: 'series-1',
        approvalStatus: SeriesApprovalStatus.APPROVED,
        characters: [{ id: 'c1' }],
        episodes: [
          {
            id: 'ep-1',
            episodeNumber: 1,
            status: SeriesEpisodeStatus.PRODUCING,
            script: 'script',
            productionState: SeriesEpisodeProductionState.RUNNING,
            approvalStatus: SeriesApprovalStatus.APPROVED,
          },
        ],
        status: 'ACTIVE',
      },
    });
    const result = await service.resolveNextAction('user-1', 'lane-1', {
      episodeApprovalRequired: true,
      automaticPublishing: false,
    });
    expect(result.action).toBe(SeriesExecutionAction.IDLE_REPORT);
  });
});

describe('SeriesExecutionService.runLaneNow gates', () => {
  it('blocks paused lanes', async () => {
    const prisma = {
      setting: { findUnique: jest.fn(async () => null) },
      seriesExecution: { findFirst: jest.fn() },
    };
    const configService = {
      getOrCreate: jest.fn(async () => ({
        seriesStudioEnabled: true,
        runMode: 'ENABLED',
        emergencyStopAt: null,
        morningLaneEnabled: true,
        eveningLaneEnabled: true,
      })),
    };
    const lanes = {
      getOwned: jest.fn(async () => ({
        id: 'lane-1',
        enabled: true,
        status: SeriesLaneStatus.PAUSED,
        laneType: 'MORNING',
      })),
      isLaneConfigEnabled: jest.fn(() => true),
      canLaneAcceptWork: jest.fn(() => false),
    };
    const service = new SeriesExecutionService(
      prisma as never,
      configService as never,
      lanes as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.runLaneNow('user-1', 'lane-1', {})).rejects.toThrow(/paused|resume/i);
  });

  it('blocks emergency stop', async () => {
    const configService = {
      getOrCreate: jest.fn(async () => ({
        seriesStudioEnabled: true,
        runMode: 'EMERGENCY_STOP',
        emergencyStopAt: new Date(),
      })),
    };
    const service = new SeriesExecutionService(
      {} as never,
      configService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.runLaneNow('user-1', 'lane-1', {})).rejects.toThrow(/emergency stop/i);
  });
});
