import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesApprovalStatus,
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesExecutionAction,
  SeriesExecutionStatus,
  SeriesExecutionTrigger,
  SeriesProductionRunStatus,
  StorySeriesStatus,
} from '@prisma/client';
import {
  computeNextProductionAt,
  computeNextPublishAt,
  isLaneProductionEligible,
  type SeriesProductionStartModeName,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CharacterDirectorService } from './character-director.service';
import { EpisodeDirectorService } from './episode-director.service';
import { MovieArchitectService } from './movie-architect.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesOrchestratorService } from './series-orchestrator.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';
import type { PlanMoviesDto, PrepareNextEpisodesDto } from './dto/plan-movies.dto';
import type { RunSeriesLaneNowDto } from './dto/run-series-now.dto';

type ResolveResult = {
  action: SeriesExecutionAction;
  seriesId?: string;
  episodeId?: string;
  reason: string;
  displayState: string;
};

@Injectable()
export class SeriesExecutionService {
  private readonly logger = new Logger(SeriesExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: SeriesConfigService,
    private readonly lanes: SeriesLaneService,
    private readonly architect: MovieArchitectService,
    private readonly characters: CharacterDirectorService,
    private readonly episodes: EpisodeDirectorService,
    private readonly orchestrator: SeriesOrchestratorService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
  ) {}

  async runLaneNow(userId: string, laneId: string, dto: RunSeriesLaneNowDto = {}) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio before using Run Now');
    }
    if (config.runMode === 'EMERGENCY_STOP' || config.emergencyStopAt) {
      throw new BadRequestException('Series Studio is in emergency stop — Run Now blocked');
    }
    if (!(await this.isGlobalEmergencyClear())) {
      throw new BadRequestException('Global emergency stop is active — Run Now blocked');
    }

    const lane = await this.lanes.getOwned(userId, laneId);
    if (!this.lanes.isLaneConfigEnabled(lane, config)) {
      throw new BadRequestException('Lane is disabled');
    }
    if (!this.lanes.canLaneAcceptWork(lane)) {
      throw new BadRequestException(
        `Lane is ${lane.status.toLowerCase()} — resume it before Run Now`,
      );
    }

    const active = await this.findActiveExecution(userId, laneId);
    if (active) {
      return {
        started: false,
        skipped: true,
        reason: 'Lane already has an active execution',
        execution: this.serialize(active),
      };
    }

    const resolved = await this.resolveNextAction(userId, laneId, config);
    const idempotencyKey = this.buildIdempotencyKey(
      laneId,
      resolved.action,
      resolved.seriesId,
      resolved.episodeId,
    );

    const existing = await this.prisma.seriesExecution.findUnique({
      where: { idempotencyKey },
    });
    if (
      existing &&
      ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL'].includes(existing.status) &&
      existing.createdAt.getTime() > Date.now() - 30 * 60_000
    ) {
      return {
        started: false,
        skipped: true,
        reason: 'Duplicate active execution prevented',
        execution: this.serialize(existing),
      };
    }

    const execution = await this.prisma.seriesExecution.create({
      data: {
        userId,
        laneId,
        triggerSource: SeriesExecutionTrigger.MANUAL,
        requestedAction: resolved.action,
        resolvedAction: resolved.action,
        status:
          resolved.action === SeriesExecutionAction.AWAIT_SERIES_APPROVAL ||
          resolved.action === SeriesExecutionAction.AWAIT_EPISODE_APPROVAL
            ? SeriesExecutionStatus.AWAITING_APPROVAL
            : resolved.action === SeriesExecutionAction.IDLE_REPORT
              ? SeriesExecutionStatus.SKIPPED
              : SeriesExecutionStatus.RUNNING,
        seriesId: resolved.seriesId,
        episodeId: resolved.episodeId,
        idempotencyKey:
          existing && existing.status !== SeriesExecutionStatus.QUEUED
            ? `${idempotencyKey}:${Date.now()}`
            : idempotencyKey,
        startedAt: new Date(),
        resultSummary: {
          reason: resolved.reason,
          displayState: resolved.displayState,
        } as Prisma.InputJsonValue,
        metadata: {
          useMockAi: dto.useMockAi === true,
          useCustomIdea: dto.useCustomIdea === true,
          hasCustomPremise: Boolean(dto.customPremise?.trim()),
        } as Prisma.InputJsonValue,
      },
    });

    if (
      execution.status === SeriesExecutionStatus.AWAITING_APPROVAL ||
      execution.status === SeriesExecutionStatus.SKIPPED
    ) {
      await this.prisma.seriesExecution.update({
        where: { id: execution.id },
        data: { completedAt: new Date() },
      });
      return {
        started: false,
        skipped: execution.status === SeriesExecutionStatus.SKIPPED,
        awaitingApproval: execution.status === SeriesExecutionStatus.AWAITING_APPROVAL,
        reason: resolved.reason,
        displayState: resolved.displayState,
        execution: this.serialize({
          ...execution,
          completedAt: new Date(),
        }),
      };
    }

    try {
      const result = await this.dispatch(
        userId,
        laneId,
        resolved,
        dto,
        execution.id,
      );
      const updated = await this.prisma.seriesExecution.update({
        where: { id: execution.id },
        data: {
          status: SeriesExecutionStatus.COMPLETED,
          completedAt: new Date(),
          queueJobIds: (result.queueJobIds ?? []) as Prisma.InputJsonValue,
          resultSummary: {
            reason: resolved.reason,
            displayState: resolved.displayState,
            ...result.summary,
          } as Prisma.InputJsonValue,
          seriesId: result.seriesId ?? resolved.seriesId,
          episodeId: result.episodeId ?? resolved.episodeId,
        },
      });
      return {
        started: true,
        queued: result.queued === true,
        reason: resolved.reason,
        displayState: resolved.displayState,
        execution: this.serialize(updated),
        result: result.summary,
      };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Run Now failed lane=${laneId}: ${message}`);
      const failed = await this.prisma.seriesExecution.update({
        where: { id: execution.id },
        data: {
          status: SeriesExecutionStatus.FAILED,
          completedAt: new Date(),
          errorMessage: message,
        },
      });
      throw Object.assign(
        error instanceof BadRequestException
          ? error
          : new BadRequestException(message),
        { execution: this.serialize(failed) },
      );
    }
  }

  async runAllEnabledNow(userId: string, dto: { useMockAi?: boolean } = {}) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio before using Run All');
    }
    if (config.runMode === 'EMERGENCY_STOP' || config.emergencyStopAt) {
      throw new BadRequestException('Series Studio is in emergency stop');
    }
    if (!(await this.isGlobalEmergencyClear())) {
      throw new BadRequestException('Global emergency stop is active');
    }

    const lanes = await this.lanes.list(userId);
    const results: Array<Record<string, unknown>> = [];

    for (const lane of lanes) {
      if (!this.lanes.isLaneConfigEnabled(lane, config)) {
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: 'skipped',
          reason: 'Lane disabled',
        });
        continue;
      }
      if (!this.lanes.canLaneAcceptWork(lane)) {
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: 'skipped',
          reason: `Lane ${lane.status}`,
        });
        continue;
      }

      try {
        const outcome = await this.runLaneNow(userId, lane.id, {
          useMockAi: dto.useMockAi,
        });
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: outcome.started
            ? 'started'
            : outcome.awaitingApproval
              ? 'awaiting_approval'
              : 'skipped',
          reason: outcome.reason,
          displayState: outcome.displayState,
          executionId: outcome.execution?.id,
          execution: outcome.execution,
        });
      } catch (error) {
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: 'failed',
          reason: (error as Error).message,
        });
      }
    }

    return {
      message:
        'Jobs have been evaluated per lane. Started jobs are queued and may still be running.',
      results,
    };
  }

  async listExecutions(
    userId: string,
    opts?: { laneId?: string; take?: number; skip?: number },
  ) {
    const take = Math.min(opts?.take ?? 30, 100);
    const skip = opts?.skip ?? 0;
    const where: Prisma.SeriesExecutionWhereInput = {
      userId,
      ...(opts?.laneId ? { laneId: opts.laneId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.seriesExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          lane: { select: { id: true, name: true, laneType: true } },
        },
      }),
      this.prisma.seriesExecution.count({ where }),
    ]);
    return { items: items.map((e) => this.serialize(e)), total };
  }

  async getExecution(userId: string, executionId: string) {
    const execution = await this.prisma.seriesExecution.findFirst({
      where: { id: executionId, userId },
      include: {
        lane: { select: { id: true, name: true, laneType: true } },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return this.serialize(execution);
  }

  /** Dashboard-friendly status for a lane card. */
  async getLaneExecutionView(userId: string, laneId: string) {
    const lane = await this.lanes.getOwned(userId, laneId);
    const config = await this.configService.getOrCreate(userId);
    const resolved = await this.resolveNextAction(userId, laneId, config);
    const latest = await this.prisma.seriesExecution.findFirst({
      where: { userId, laneId },
      orderBy: { createdAt: 'desc' },
    });
    const active = await this.findActiveExecution(userId, laneId);
    const now = new Date();
    const nextPublishAt =
      lane.nextPublishAt ??
      computeNextPublishAt(now, lane.timezone, lane.publishTime);
    const nextProductionAt =
      lane.nextProductionAt ??
      computeNextProductionAt(
        now,
        lane.timezone,
        lane.publishTime,
        lane.productionLeadTimeMinutes,
        lane.preferredProductionTime,
      );

    let productionStage: string | null = null;
    let currentEpisode: {
      id: string;
      episodeNumber: number;
      status: string;
      approvalStatus: string;
      blockedReason: string | null;
    } | null = null;
    let nextEpisode: {
      id: string;
      episodeNumber: number;
      status: string;
      approvalStatus: string;
    } | null = null;
    let lastPublishedEpisode: {
      id: string;
      episodeNumber: number;
      publishedAt: Date | null;
    } | null = null;
    let blocker: string | null = null;

    if (lane.activeSeriesId) {
      const episodes = await this.prisma.seriesEpisode.findMany({
        where: { seriesId: lane.activeSeriesId },
        orderBy: { episodeNumber: 'asc' },
        include: {
          productionRuns: {
            where: {
              status: {
                in: [
                  SeriesProductionRunStatus.PENDING,
                  SeriesProductionRunStatus.RUNNING,
                  SeriesProductionRunStatus.RETRYING,
                ],
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      const producing = episodes.find(
        (e) =>
          e.productionState === SeriesEpisodeProductionState.QUEUED ||
          e.productionState === SeriesEpisodeProductionState.RUNNING ||
          e.status === SeriesEpisodeStatus.PRODUCING ||
          e.status === SeriesEpisodeStatus.SCRIPTING,
      );
      if (producing) {
        currentEpisode = {
          id: producing.id,
          episodeNumber: producing.episodeNumber,
          status: producing.status,
          approvalStatus: producing.approvalStatus,
          blockedReason: producing.blockedReason,
        };
        productionStage =
          producing.productionRuns[0]?.stage ?? producing.productionState ?? null;
        blocker = producing.blockedReason;
      }

      const awaiting = episodes.find(
        (e) =>
          e.status === SeriesEpisodeStatus.SCRIPT_READY ||
          (e.approvalStatus === SeriesApprovalStatus.PENDING && e.script),
      );
      if (awaiting && !blocker) {
        blocker = `Episode ${awaiting.episodeNumber} awaiting approval`;
        currentEpisode = currentEpisode ?? {
          id: awaiting.id,
          episodeNumber: awaiting.episodeNumber,
          status: awaiting.status,
          approvalStatus: awaiting.approvalStatus,
          blockedReason: awaiting.blockedReason,
        };
      }

      const nextPlanned = episodes.find(
        (e) =>
          e.status === SeriesEpisodeStatus.PLANNED ||
          e.status === SeriesEpisodeStatus.APPROVED,
      );
      if (nextPlanned) {
        nextEpisode = {
          id: nextPlanned.id,
          episodeNumber: nextPlanned.episodeNumber,
          status: nextPlanned.status,
          approvalStatus: nextPlanned.approvalStatus,
        };
      }

      const published = [...episodes]
        .reverse()
        .find((e) => e.status === SeriesEpisodeStatus.PUBLISHED);
      if (published) {
        lastPublishedEpisode = {
          id: published.id,
          episodeNumber: published.episodeNumber,
          publishedAt: published.publishedAt,
        };
      }

      if (!blocker) {
        const blocked = episodes.find((e) => e.blockedReason);
        if (blocked) blocker = blocked.blockedReason;
      }
    }

    const movieApprovalStillRequired =
      config.effectiveMovieApprovalRequired !== false &&
      config.autonomyMode !== 'FULLY_AUTONOMOUS';
    if (
      movieApprovalStillRequired &&
      (lane.activeSeries?.approvalStatus === SeriesApprovalStatus.PENDING ||
        lane.activeSeries?.approvalStatus === SeriesApprovalStatus.NEEDS_REVISION)
    ) {
      blocker = blocker ?? 'Movie awaiting approval';
    }

    return {
      laneId: lane.id,
      name: lane.name,
      displayState: active
        ? this.mapExecutionToDisplay(active)
        : resolved.displayState,
      nextAction: resolved.action,
      nextActionReason: resolved.reason,
      productionStage,
      productionStartMode: lane.productionStartMode,
      productionLeadTimeMinutes: lane.productionLeadTimeMinutes,
      preferredProductionTime: lane.preferredProductionTime,
      nextPublishAt,
      nextProductionAt,
      currentEpisode,
      nextEpisode,
      lastPublishedEpisode,
      blocker,
      approvalStatus: lane.activeSeries?.approvalStatus ?? null,
      activeMovie: lane.activeSeries
        ? {
            id: lane.activeSeries.id,
            title: lane.activeSeries.title,
            status: lane.activeSeries.status,
            approvalStatus: lane.activeSeries.approvalStatus,
            currentEpisodeNumber: lane.activeSeries.currentEpisodeNumber,
            plannedEpisodeCount: lane.activeSeries.plannedEpisodeCount,
          }
        : null,
      lastExecution: latest ? this.serialize(latest) : null,
      activeExecution: active ? this.serialize(active) : null,
    };
  }

  /**
   * Plan complete movies for one or more lanes without starting expensive media
   * unless startMediaProduction is explicitly true.
   */
  async planMoviesForLanes(userId: string, dto: PlanMoviesDto) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio before planning movies');
    }

    const allLanes = await this.lanes.list(userId);
    const targets: Array<{
      laneId: string;
      ideaMode?: 'generate' | 'custom';
      customPremise?: string;
    }> =
      dto.lanes && dto.lanes.length > 0
        ? dto.lanes
        : allLanes
            .filter((l) => this.lanes.isLaneConfigEnabled(l, config))
            .map((l) => ({ laneId: l.id, ideaMode: 'generate' as const }));

    const startMedia =
      dto.startMediaProduction === true || config.startMediaAfterMoviePlanning === true;

    const results: Array<Record<string, unknown>> = [];
    for (const target of targets) {
      const lane = allLanes.find((l) => l.id === target.laneId);
      if (!lane) {
        results.push({ laneId: target.laneId, status: 'error', reason: 'Lane not found' });
        continue;
      }
      try {
        const ideaMode =
          target.ideaMode === 'custom' && target.customPremise?.trim()
            ? 'custom'
            : 'generate';
        const generated = await this.architect.generate(userId, {
          laneId: target.laneId,
          ideaMode,
          customPremise: target.customPremise,
          useMockAi: dto.useMockAi,
          async: dto.async !== false,
          setAsActive: true,
        });

        await this.prisma.seriesExecution.create({
          data: {
            userId,
            laneId: target.laneId,
            triggerSource: SeriesExecutionTrigger.MANUAL,
            requestedAction: SeriesExecutionAction.PLAN_MOVIE,
            resolvedAction: SeriesExecutionAction.PLAN_MOVIE,
            status: SeriesExecutionStatus.COMPLETED,
            seriesId: (generated as { series?: { id: string } }).series?.id,
            idempotencyKey: `plan-movies:${target.laneId}:${Date.now()}`,
            startedAt: new Date(),
            completedAt: new Date(),
            resultSummary: {
              startMediaProduction: startMedia,
              planOnly: !startMedia,
            } as Prisma.InputJsonValue,
            metadata: {
              workflow: 'plan_movies_in_advance',
              startMediaProduction: startMedia,
            } as Prisma.InputJsonValue,
          },
        });

        results.push({
          laneId: target.laneId,
          name: lane.name,
          status: 'queued',
          startMediaProduction: startMedia,
          result: generated,
        });
      } catch (error) {
        results.push({
          laneId: target.laneId,
          name: lane.name,
          status: 'error',
          reason: (error as Error).message,
        });
      }
    }

    return {
      planned: results.filter((r) => r.status === 'queued').length,
      startMediaProduction: startMedia,
      note: startMedia
        ? 'Media production may begin after approvals according to lane production schedule.'
        : 'Movies planned only — media production will not start until the production window / Produce Next / Run Now.',
      results,
    };
  }

  /** Queue eligible episode prep across lanes (respects windows unless ignoreScheduleWindow). */
  async prepareNextEpisodes(userId: string, dto: PrepareNextEpisodesDto = {}) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio first');
    }
    if (!this.configService.canScheduleNewWork(config) && !dto.ignoreScheduleWindow) {
      throw new BadRequestException('Series Studio is paused or emergency-stopped');
    }

    const lanes = await this.lanes.list(userId);
    const selected = dto.laneIds?.length
      ? lanes.filter((l) => dto.laneIds!.includes(l.id))
      : lanes.filter((l) => this.lanes.isLaneConfigEnabled(l, config));

    const results: Array<Record<string, unknown>> = [];
    for (const lane of selected) {
      if (!this.lanes.canLaneAcceptWork(lane)) {
        results.push({ laneId: lane.id, status: 'skipped', reason: `Lane ${lane.status}` });
        continue;
      }

      const eligible =
        dto.ignoreScheduleWindow === true ||
        isLaneProductionEligible({
          now: new Date(),
          timeZone: lane.timezone,
          publishTime: lane.publishTime,
          leadTimeMinutes: lane.productionLeadTimeMinutes,
          preferredProductionTime: lane.preferredProductionTime,
          productionStartMode: lane.productionStartMode as SeriesProductionStartModeName,
          customProductionStartAt: lane.customProductionStartAt,
        });

      if (!eligible) {
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: 'waiting_for_schedule',
          reason: 'Production window not open yet',
          nextProductionAt: lane.nextProductionAt,
        });
        continue;
      }

      try {
        const outcome = await this.runLaneNow(userId, lane.id, {
          useMockAi: dto.useMockAi,
        });
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: outcome.awaitingApproval
            ? 'awaiting_approval'
            : outcome.skipped
              ? 'skipped'
              : 'started',
          ...outcome,
        });
      } catch (error) {
        results.push({
          laneId: lane.id,
          name: lane.name,
          status: 'error',
          reason: (error as Error).message,
        });
      }
    }

    return { results };
  }

  /** Manually start media production for the next approved episode on a lane. */
  async produceNextEpisode(
    userId: string,
    laneId: string,
    opts?: { useMockAi?: boolean },
  ) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled) {
      throw new BadRequestException('Enable Series Studio first');
    }
    const lane = await this.lanes.getOwned(userId, laneId);
    if (!lane.activeSeriesId) {
      throw new BadRequestException('Lane has no active movie');
    }

    const episode = await this.prisma.seriesEpisode.findFirst({
      where: {
        seriesId: lane.activeSeriesId,
        status: SeriesEpisodeStatus.APPROVED,
        productionState: SeriesEpisodeProductionState.IDLE,
        approvalStatus: SeriesApprovalStatus.APPROVED,
      },
      orderBy: { episodeNumber: 'asc' },
    });
    if (!episode) {
      throw new BadRequestException(
        'No approved episode ready for media production (check scripts / approvals)',
      );
    }

    const result = await this.orchestrator.startProduction(
      userId,
      lane.activeSeriesId,
      episode.id,
      {
        async: true,
        useMockAi: opts?.useMockAi,
        manualTrigger: true,
      },
    );

    await this.prisma.seriesExecution.create({
      data: {
        userId,
        laneId,
        triggerSource: SeriesExecutionTrigger.MANUAL,
        requestedAction: SeriesExecutionAction.PRODUCE_EPISODE,
        resolvedAction: SeriesExecutionAction.PRODUCE_EPISODE,
        status: SeriesExecutionStatus.COMPLETED,
        seriesId: lane.activeSeriesId,
        episodeId: episode.id,
        idempotencyKey: `produce-next:${laneId}:${episode.id}:${Date.now()}`,
        startedAt: new Date(),
        completedAt: new Date(),
        resultSummary: { production: result } as Prisma.InputJsonValue,
      },
    });

    return { episodeId: episode.id, episodeNumber: episode.episodeNumber, ...result };
  }

  async resolveNextAction(
    userId: string,
    laneId: string,
    config: {
      episodeApprovalRequired: boolean;
      automaticPublishing: boolean;
      autonomyMode?: string;
      movieApprovalRequired?: boolean;
      effectiveEpisodeApprovalRequired?: boolean;
      effectiveMovieApprovalRequired?: boolean;
    },
  ): Promise<ResolveResult> {
    const lane = await this.lanes.getOwned(userId, laneId);

    if (!lane.activeSeriesId) {
      return {
        action: SeriesExecutionAction.PLAN_MOVIE,
        reason: 'No active movie — start movie concept generation',
        displayState: 'Idle',
      };
    }

    const series = await this.prisma.storySeries.findFirst({
      where: { id: lane.activeSeriesId, userId, laneId },
      include: {
        characters: { select: { id: true }, take: 1 },
        episodes: { orderBy: { episodeNumber: 'asc' } },
      },
    });

    if (!series) {
      return {
        action: SeriesExecutionAction.PLAN_MOVIE,
        reason: 'Active series missing — plan a new movie',
        displayState: 'Idle',
      };
    }

    const movieApprovalRequired =
      config.effectiveMovieApprovalRequired ??
      (config.autonomyMode === 'FULLY_AUTONOMOUS'
        ? false
        : config.movieApprovalRequired !== false);

    if (
      movieApprovalRequired &&
      (series.approvalStatus === SeriesApprovalStatus.PENDING ||
        series.approvalStatus === SeriesApprovalStatus.NEEDS_REVISION)
    ) {
      return {
        action: SeriesExecutionAction.AWAIT_SERIES_APPROVAL,
        seriesId: series.id,
        reason: 'Movie awaiting approval — approve before continuing',
        displayState: 'Awaiting Approval',
      };
    }

    // Autonomous / auto-approve mode: treat pending movie as eligible once planned (status READY).
    // Actual DB approval is performed by MovieArchitect; if still PENDING (legacy), continue
    // only when movie approval is not effectively required.
    if (
      !movieApprovalRequired &&
      (series.approvalStatus === SeriesApprovalStatus.PENDING ||
        series.approvalStatus === SeriesApprovalStatus.NEEDS_REVISION)
    ) {
      // Fall through — do not block Run Now / monitoring on approval when autonomy overrides.
    }

    if (series.approvalStatus === SeriesApprovalStatus.REJECTED) {
      return {
        action: SeriesExecutionAction.PLAN_MOVIE,
        seriesId: series.id,
        reason: 'Active movie was rejected — plan a new movie',
        displayState: 'Idle',
      };
    }

    if (series.characters.length === 0) {
      return {
        action: SeriesExecutionAction.GENERATE_CHARACTERS,
        seriesId: series.id,
        reason: 'Approved movie has no characters yet',
        displayState: 'Generating Characters',
      };
    }

    const producing = series.episodes.find(
      (e) =>
        e.status === SeriesEpisodeStatus.PRODUCING ||
        e.productionState === SeriesEpisodeProductionState.QUEUED ||
        e.productionState === SeriesEpisodeProductionState.RUNNING ||
        e.status === SeriesEpisodeStatus.SCRIPTING,
    );
    if (producing) {
      return {
        action: SeriesExecutionAction.IDLE_REPORT,
        seriesId: series.id,
        episodeId: producing.id,
        reason: `Episode ${producing.episodeNumber} is already processing (${producing.status})`,
        displayState:
          producing.status === SeriesEpisodeStatus.SCRIPTING
            ? 'Planning Episode'
            : 'Rendering',
      };
    }

    const awaitingEpisode = series.episodes.find(
      (e) =>
        (e.status === SeriesEpisodeStatus.SCRIPT_READY ||
          e.approvalStatus === SeriesApprovalStatus.PENDING) &&
        e.status !== SeriesEpisodeStatus.APPROVED &&
        e.status !== SeriesEpisodeStatus.PLANNED &&
        e.script,
    );
    const episodeApprovalRequired =
      config.effectiveEpisodeApprovalRequired ??
      (config.autonomyMode === 'FULLY_AUTONOMOUS'
        ? false
        : config.episodeApprovalRequired !== false);

    if (
      awaitingEpisode &&
      episodeApprovalRequired &&
      awaitingEpisode.approvalStatus !== SeriesApprovalStatus.APPROVED
    ) {
      return {
        action: SeriesExecutionAction.AWAIT_EPISODE_APPROVAL,
        seriesId: series.id,
        episodeId: awaitingEpisode.id,
        reason: `Episode ${awaitingEpisode.episodeNumber} awaiting approval — Run Now will not bypass approval`,
        displayState: 'Awaiting Approval',
      };
    }

    // Autonomy / approval-off: pending script-ready episodes proceed to production
    // (dispatch auto-approves before produce when needed).
    if (
      awaitingEpisode &&
      !episodeApprovalRequired &&
      awaitingEpisode.approvalStatus !== SeriesApprovalStatus.APPROVED
    ) {
      return {
        action: SeriesExecutionAction.PRODUCE_EPISODE,
        seriesId: series.id,
        episodeId: awaitingEpisode.id,
        reason: `Episode ${awaitingEpisode.episodeNumber} script ready — auto-approve and produce (autonomy)`,
        displayState: 'Generating Visuals',
      };
    }

    const needsScript = series.episodes.find(
      (e) =>
        e.status === SeriesEpisodeStatus.PLANNED ||
        (e.status === SeriesEpisodeStatus.FAILED && !e.script),
    );
    if (needsScript) {
      return {
        action: SeriesExecutionAction.PLAN_EPISODE,
        seriesId: series.id,
        episodeId: needsScript.id,
        reason: `Generate script for episode ${needsScript.episodeNumber}`,
        displayState: 'Planning Episode',
      };
    }

    const readyToProduce = series.episodes.find(
      (e) =>
        e.status === SeriesEpisodeStatus.APPROVED &&
        e.productionState === SeriesEpisodeProductionState.IDLE &&
        e.approvalStatus === SeriesApprovalStatus.APPROVED,
    );
    if (readyToProduce) {
      return {
        action: SeriesExecutionAction.PRODUCE_EPISODE,
        seriesId: series.id,
        episodeId: readyToProduce.id,
        reason: `Start production for episode ${readyToProduce.episodeNumber}`,
        displayState: 'Generating Visuals',
      };
    }

    const rendered = series.episodes.find(
      (e) =>
        e.status === SeriesEpisodeStatus.RENDERED ||
        (e.status === SeriesEpisodeStatus.APPROVED &&
          e.productionState === SeriesEpisodeProductionState.COMPLETED),
    );
    if (rendered && config.automaticPublishing) {
      return {
        action: SeriesExecutionAction.ENSURE_SCHEDULE,
        seriesId: series.id,
        episodeId: rendered.id,
        reason: `Episode ${rendered.episodeNumber} ready — ensure publish schedule`,
        displayState: 'Ready to Publish',
      };
    }

    if (rendered && !config.automaticPublishing) {
      return {
        action: SeriesExecutionAction.IDLE_REPORT,
        seriesId: series.id,
        episodeId: rendered.id,
        reason: `Episode ${rendered.episodeNumber} rendered; automatic publishing is off`,
        displayState: 'Ready to Publish',
      };
    }

    const publishedAll =
      series.episodes.length > 0 &&
      series.episodes.every(
        (e) =>
          e.status === SeriesEpisodeStatus.PUBLISHED ||
          e.status === SeriesEpisodeStatus.SKIPPED,
      );
    if (publishedAll || series.status === StorySeriesStatus.COMPLETED) {
      return {
        action: SeriesExecutionAction.REPLACE_MOVIE,
        seriesId: series.id,
        reason: 'Movie complete — start replacement planning',
        displayState: 'Published',
      };
    }

    return {
      action: SeriesExecutionAction.IDLE_REPORT,
      seriesId: series.id,
      reason: 'No eligible next step (check approvals or episode states)',
      displayState: 'Idle',
    };
  }

  private async dispatch(
    userId: string,
    laneId: string,
    resolved: ResolveResult,
    dto: RunSeriesLaneNowDto,
    executionId: string,
  ): Promise<{
    queued?: boolean;
    queueJobIds?: string[];
    seriesId?: string;
    episodeId?: string;
    summary: Record<string, unknown>;
  }> {
    const useMockAi =
      dto.useMockAi === true || process.env.GEMINI_USE_MOCK === 'true';

    switch (resolved.action) {
      case SeriesExecutionAction.PLAN_MOVIE: {
        const ideaMode =
          dto.useCustomIdea && dto.customPremise?.trim() ? 'custom' : 'generate';
        const result = await this.architect.generate(userId, {
          laneId,
          ideaMode,
          customPremise: dto.customPremise,
          useMockAi,
          async: true,
          setAsActive: true,
        });
        return {
          queued: Boolean((result as { queued?: boolean }).queued),
          queueJobIds: [(result as { jobId?: string }).jobId].filter(Boolean) as string[],
          seriesId: (result as { series?: { id: string } }).series?.id,
          summary: { generate: result, executionId },
        };
      }
      case SeriesExecutionAction.GENERATE_CHARACTERS: {
        const { seriesId } = resolved;
        if (!seriesId) throw new BadRequestException('Missing seriesId');
        const chars = await this.prisma.seriesCharacter.count({ where: { seriesId } });
        if (chars === 0) {
          throw new BadRequestException(
            'Characters missing — regenerate movie plan for this lane',
          );
        }
        const refs = await this.characters.generateReferencesForSeries(userId, seriesId);
        return {
          seriesId,
          summary: {
            message: 'Character reference generation started',
            characterCount: chars,
            refs,
            executionId,
          },
        };
      }
      case SeriesExecutionAction.PLAN_EPISODE: {
        if (!resolved.seriesId || !resolved.episodeId) {
          throw new BadRequestException('Missing episode for planning');
        }
        const result = await this.episodes.generateEpisode(
          userId,
          resolved.seriesId,
          resolved.episodeId,
          { useMockAi, async: true },
        );
        return {
          queued: Boolean((result as { queued?: boolean }).queued),
          queueJobIds: [(result as { jobId?: string }).jobId].filter(Boolean) as string[],
          seriesId: resolved.seriesId,
          episodeId: resolved.episodeId,
          summary: { episode: result, executionId },
        };
      }
      case SeriesExecutionAction.PRODUCE_EPISODE: {
        if (!resolved.seriesId || !resolved.episodeId) {
          throw new BadRequestException('Missing episode for production');
        }
        const episode = await this.prisma.seriesEpisode.findFirst({
          where: {
            id: resolved.episodeId,
            seriesId: resolved.seriesId,
            series: { userId },
          },
          select: { approvalStatus: true, status: true },
        });
        if (
          episode &&
          episode.approvalStatus !== SeriesApprovalStatus.APPROVED
        ) {
          await this.episodes.approveEpisode(
            userId,
            resolved.seriesId,
            resolved.episodeId,
          );
        }
        const result = await this.orchestrator.startProduction(
          userId,
          resolved.seriesId,
          resolved.episodeId,
          { async: true, useMockAi, manualTrigger: true },
        );
        return {
          queued: true,
          seriesId: resolved.seriesId,
          episodeId: resolved.episodeId,
          summary: { production: result, executionId },
        };
      }
      case SeriesExecutionAction.ENSURE_SCHEDULE: {
        const result = await this.publishScheduler.ensureNextSchedule(userId, laneId);
        return {
          seriesId: resolved.seriesId,
          episodeId: resolved.episodeId,
          summary: { schedule: result, executionId },
        };
      }
      case SeriesExecutionAction.REPLACE_MOVIE: {
        const result = await this.architect.generate(userId, {
          laneId,
          useMockAi,
          async: true,
          asReplacementCandidate: true,
          setAsActive: false,
        });
        return {
          queued: Boolean((result as { queued?: boolean }).queued),
          queueJobIds: [(result as { jobId?: string }).jobId].filter(Boolean) as string[],
          summary: { replacement: result, executionId },
        };
      }
      default:
        return { summary: { message: 'No dispatch', executionId } };
    }
  }

  private async findActiveExecution(userId: string, laneId: string) {
    return this.prisma.seriesExecution.findFirst({
      where: {
        userId,
        laneId,
        status: {
          in: [
            SeriesExecutionStatus.QUEUED,
            SeriesExecutionStatus.RUNNING,
          ],
        },
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private buildIdempotencyKey(
    laneId: string,
    action: SeriesExecutionAction,
    seriesId?: string,
    episodeId?: string,
  ) {
    const bucket = Math.floor(Date.now() / (5 * 60_000));
    return `series-exec:${laneId}:${action}:${seriesId ?? 'none'}:${episodeId ?? 'none'}:${bucket}`;
  }

  private async isGlobalEmergencyClear() {
    const emergency = await this.prisma.setting.findUnique({
      where: { key: 'system:automation:emergencyStop' },
    });
    if (!emergency?.value || typeof emergency.value !== 'object') return true;
    return (emergency.value as { active?: boolean }).active !== true;
  }

  private mapExecutionToDisplay(execution: {
    status: SeriesExecutionStatus;
    resolvedAction: SeriesExecutionAction | null;
    requestedAction: SeriesExecutionAction;
  }): string {
    if (execution.status === SeriesExecutionStatus.QUEUED) return 'Queued';
    if (execution.status === SeriesExecutionStatus.FAILED) return 'Failed';
    if (execution.status === SeriesExecutionStatus.CANCELLED) return 'Cancelled';
    if (execution.status === SeriesExecutionStatus.AWAITING_APPROVAL) {
      return 'Awaiting Approval';
    }
    const action = execution.resolvedAction ?? execution.requestedAction;
    switch (action) {
      case SeriesExecutionAction.PLAN_MOVIE:
        return 'Planning Movie';
      case SeriesExecutionAction.GENERATE_CHARACTERS:
        return 'Generating Characters';
      case SeriesExecutionAction.PLAN_EPISODE:
        return 'Planning Episode';
      case SeriesExecutionAction.PRODUCE_EPISODE:
        return 'Generating Visuals';
      case SeriesExecutionAction.ENSURE_SCHEDULE:
      case SeriesExecutionAction.PUBLISH:
        return 'Publishing';
      default:
        return 'Queued';
    }
  }

  serialize(
    execution: Prisma.SeriesExecutionGetPayload<{
      include?: { lane?: { select: { id: true; name: true; laneType: true } } };
    }>,
  ) {
    return {
      ...execution,
      queueJobIds: execution.queueJobIds ?? [],
      resultSummary: execution.resultSummary ?? {},
      metadata: execution.metadata ?? {},
    };
  }
}
