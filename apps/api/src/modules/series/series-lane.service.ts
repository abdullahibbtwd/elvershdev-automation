import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesLaneStatus,
  SeriesLaneType,
} from '@prisma/client';
import {
  SERIES_DEFAULTS,
  SERIES_DIALOGUE_CREATIVE_DEFAULTS,
  SERIES_NOTIFICATION_TYPES,
  computeNextProductionAt,
  computeNextPublishAt,
  parseSeriesCreativeSettings,
  seriesCreativeSettingsSchema,
} from '@ai-video/shared';
import { SeriesProductionStartMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSeriesLaneDto } from './dto/create-series-lane.dto';
import { UpdateSeriesLaneDto } from './dto/update-series-lane.dto';

function parseLaneCreativeSettings(raw: unknown) {
  const parsed = seriesCreativeSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'creativeSettings'}: ${issue.message}`)
    .join('; ');
  throw new BadRequestException(`Invalid lane creative settings — ${details}`);
}

const ACTIVE_SERIES_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  plannedEpisodeCount: true,
  currentEpisodeNumber: true,
  approvalStatus: true,
} as const;

@Injectable()
export class SeriesLaneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async ensureDefaultLanes(userId: string) {
    const existing = await this.prisma.seriesLane.findMany({
      where: { userId, deletedAt: null },
    });
    const byType = new Map(existing.map((lane) => [lane.laneType, lane]));

    if (!byType.has(SeriesLaneType.MORNING)) {
      await this.prisma.seriesLane.create({
        data: {
          userId,
          laneType: SeriesLaneType.MORNING,
          name: 'Series A (Morning)',
          description: 'Morning publish lane',
          enabled: true,
          status: SeriesLaneStatus.PAUSED,
          publishTime: SERIES_DEFAULTS.morningPublishTime,
          timezone: SERIES_DEFAULTS.timezone, // Africa/Lagos for new deployments
          productionLeadTimeMinutes: SERIES_DEFAULTS.defaultProductionLeadTimeMinutes,
          productionStartMode: SeriesProductionStartMode.NEXT_WINDOW,
          plannedEpisodeCount: SERIES_DEFAULTS.plannedEpisodeCount,
          targetEpisodeDurationSeconds: SERIES_DEFAULTS.targetEpisodeDurationSeconds,
          replacementTriggerEpisode: SERIES_DEFAULTS.replacementTriggerEpisode,
          sortOrder: 0,
          creativeSettings: SERIES_DIALOGUE_CREATIVE_DEFAULTS as Prisma.InputJsonValue,
        },
      });
    }

    if (!byType.has(SeriesLaneType.EVENING)) {
      await this.prisma.seriesLane.create({
        data: {
          userId,
          laneType: SeriesLaneType.EVENING,
          name: 'Series B (Evening)',
          description: 'Evening publish lane',
          enabled: true,
          status: SeriesLaneStatus.PAUSED,
          publishTime: SERIES_DEFAULTS.eveningPublishTime,
          timezone: SERIES_DEFAULTS.timezone, // Africa/Lagos for new deployments
          productionLeadTimeMinutes: SERIES_DEFAULTS.defaultProductionLeadTimeMinutes,
          productionStartMode: SeriesProductionStartMode.NEXT_WINDOW,
          plannedEpisodeCount: SERIES_DEFAULTS.plannedEpisodeCount,
          targetEpisodeDurationSeconds: SERIES_DEFAULTS.targetEpisodeDurationSeconds,
          replacementTriggerEpisode: SERIES_DEFAULTS.replacementTriggerEpisode,
          sortOrder: 1,
          creativeSettings: SERIES_DIALOGUE_CREATIVE_DEFAULTS as Prisma.InputJsonValue,
        },
      });
    }
  }

  async list(userId: string) {
    await this.ensureDefaultLanes(userId);
    const lanes = await this.prisma.seriesLane.findMany({
      where: { userId, deletedAt: null },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return lanes.map((lane) => this.serialize(lane));
  }

  async getOwned(userId: string, laneId: string) {
    const lane = await this.prisma.seriesLane.findFirst({
      where: { id: laneId, userId, deletedAt: null },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });
    if (!lane) throw new NotFoundException('Series lane not found');
    return lane;
  }

  async create(userId: string, dto: CreateSeriesLaneDto) {
    await this.ensureDefaultLanes(userId);
    this.assertTimezone(dto.timezone);

    const planned = dto.plannedEpisodeCount ?? SERIES_DEFAULTS.plannedEpisodeCount;
    const trigger = Math.min(
      Math.max(
        1,
        dto.replacementTriggerEpisode ?? SERIES_DEFAULTS.replacementTriggerEpisode,
      ),
      planned,
    );

    const maxSort = await this.prisma.seriesLane.aggregate({
      where: { userId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const creative = dto.creativeSettings
      ? parseLaneCreativeSettings(dto.creativeSettings)
      : parseLaneCreativeSettings(SERIES_DIALOGUE_CREATIVE_DEFAULTS);

    const created = await this.prisma.seriesLane.create({
      data: {
        userId,
        laneType: SeriesLaneType.CUSTOM,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        enabled: dto.enabled !== false,
        status: SeriesLaneStatus.PAUSED,
        publishTime: dto.publishTime ?? '12:00',
        timezone: dto.timezone ?? SERIES_DEFAULTS.timezone,
        plannedEpisodeCount: planned,
        targetEpisodeDurationSeconds:
          dto.targetEpisodeDurationSeconds ?? SERIES_DEFAULTS.targetEpisodeDurationSeconds,
        replacementTriggerEpisode: trigger,
        sortOrder: (maxSort._max.sortOrder ?? 1) + 1,
        creativeSettings: creative as Prisma.InputJsonValue,
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(userId, 'series.lane.create', null, created, created.id);
    return this.serialize(created);
  }

  async duplicate(userId: string, laneId: string) {
    const source = await this.getOwned(userId, laneId);
    const maxSort = await this.prisma.seriesLane.aggregate({
      where: { userId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const created = await this.prisma.seriesLane.create({
      data: {
        userId,
        laneType: SeriesLaneType.CUSTOM,
        name: `${source.name} (copy)`,
        description: source.description,
        enabled: source.enabled,
        status: SeriesLaneStatus.PAUSED,
        publishTime: source.publishTime,
        timezone: source.timezone,
        plannedEpisodeCount: source.plannedEpisodeCount,
        targetEpisodeDurationSeconds: source.targetEpisodeDurationSeconds,
        replacementTriggerEpisode: source.replacementTriggerEpisode,
        sortOrder: (maxSort._max.sortOrder ?? 1) + 1,
        creativeSettings: source.creativeSettings as Prisma.InputJsonValue,
        publishingConfig: source.publishingConfig as Prisma.InputJsonValue,
        metadata: {
          duplicatedFromLaneId: source.id,
        } as Prisma.InputJsonValue,
        // Intentionally do NOT copy activeSeriesId / story data
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(userId, 'series.lane.duplicate', source, created, created.id);
    return this.serialize(created);
  }

  async update(userId: string, laneId: string, dto: UpdateSeriesLaneDto) {
    const before = await this.getOwned(userId, laneId);

    if (dto.timezone) this.assertTimezone(dto.timezone);

    const planned = dto.plannedEpisodeCount ?? before.plannedEpisodeCount;
    const requestedTrigger =
      dto.replacementTriggerEpisode ?? before.replacementTriggerEpisode;
    // Keep lanes saveable after story-duration shrinks planned count; clamp trigger.
    const trigger = Math.min(Math.max(1, requestedTrigger), planned);

    if (dto.activeSeriesId) {
      const series = await this.prisma.storySeries.findFirst({
        where: { id: dto.activeSeriesId, userId, laneId },
      });
      if (!series) {
        throw new BadRequestException(
          'Active series must belong to this user and lane',
        );
      }
    }

    let creativeSettings: Prisma.InputJsonValue | undefined;
    if (dto.creativeSettings !== undefined) {
      const parsed = parseLaneCreativeSettings(dto.creativeSettings);
      creativeSettings = {
        ...parsed,
        // All lanes stay on Grok dialogue — never persist fal/narration mode.
        dialogueDrivenStorytelling: true,
        narrationPreference: parsed.narrationPreference ?? 'avoid',
        aspectRatio: '9:16',
        visualStyle:
          parsed.visualStyle?.trim() ||
          'Stylized cinematic 3D cartoon animation (Pixar/DreamWorks-like). Expressive cartoon faces, clean readable designs, consistent character model sheets. NOT photorealistic live-action humans.',
      } as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.seriesLane.update({
      where: { id: laneId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.publishTime !== undefined ? { publishTime: dto.publishTime } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.productionLeadTimeMinutes !== undefined
          ? { productionLeadTimeMinutes: dto.productionLeadTimeMinutes }
          : {}),
        ...(dto.preferredProductionTime !== undefined
          ? { preferredProductionTime: dto.preferredProductionTime }
          : {}),
        ...(dto.productionStartMode !== undefined
          ? { productionStartMode: dto.productionStartMode as SeriesProductionStartMode }
          : {}),
        ...(dto.customProductionStartAt !== undefined
          ? {
              customProductionStartAt: dto.customProductionStartAt
                ? new Date(dto.customProductionStartAt)
                : null,
            }
          : {}),
        ...(dto.plannedEpisodeCount !== undefined
          ? { plannedEpisodeCount: dto.plannedEpisodeCount }
          : {}),
        ...(dto.targetEpisodeDurationSeconds !== undefined
          ? { targetEpisodeDurationSeconds: dto.targetEpisodeDurationSeconds }
          : {}),
        ...(dto.targetStoryDurationSeconds !== undefined
          ? { targetStoryDurationSeconds: dto.targetStoryDurationSeconds }
          : {}),
        ...(dto.maxClipDurationSeconds !== undefined
          ? { maxClipDurationSeconds: dto.maxClipDurationSeconds }
          : {}),
        // Always persist a valid trigger when planned count changed or trigger was stale.
        ...(trigger !== before.replacementTriggerEpisode ||
        dto.replacementTriggerEpisode !== undefined
          ? { replacementTriggerEpisode: trigger }
          : {}),
        ...(dto.activeSeriesId !== undefined
          ? { activeSeriesId: dto.activeSeriesId }
          : {}),
        ...(dto.publishingConfig !== undefined
          ? { publishingConfig: dto.publishingConfig as Prisma.InputJsonValue }
          : {}),
        ...(creativeSettings !== undefined ? { creativeSettings } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.enabled === false
          ? { status: SeriesLaneStatus.DISABLED, pausedAt: new Date() }
          : {}),
        ...(dto.enabled === true && before.status === SeriesLaneStatus.DISABLED
          ? { status: SeriesLaneStatus.PAUSED }
          : {}),
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    const scheduleTouched =
      dto.publishTime !== undefined ||
      dto.timezone !== undefined ||
      dto.productionLeadTimeMinutes !== undefined ||
      dto.preferredProductionTime !== undefined ||
      dto.productionStartMode !== undefined ||
      dto.customProductionStartAt !== undefined;

    const finalLane = scheduleTouched
      ? await this.refreshScheduleAnchors(updated.id)
      : updated;

    await this.audit(userId, 'series.lane.update', before, finalLane, laneId);
    return this.serialize(finalLane);
  }

  /** Refresh nextPublishAt / nextProductionAt from lane schedule settings. */
  async refreshScheduleAnchors(laneId: string, now = new Date()) {
    const lane = await this.prisma.seriesLane.findUniqueOrThrow({ where: { id: laneId } });
    const nextPublishAt = computeNextPublishAt(now, lane.timezone, lane.publishTime);
    const nextProductionAt = computeNextProductionAt(
      now,
      lane.timezone,
      lane.publishTime,
      lane.productionLeadTimeMinutes,
      lane.preferredProductionTime,
    );
    return this.prisma.seriesLane.update({
      where: { id: laneId },
      data: { nextPublishAt, nextProductionAt },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });
  }

  /**
   * Wipe all story content for a lane and leave the lane shell ready for a fresh Plan Movie.
   * Deletes series (cascades episodes/characters/bible/runs), schedules, replacements, executions.
   * Does not delete the lane itself (Morning/Evening stay).
   */
  async resetLaneContent(userId: string, laneId: string) {
    const before = await this.getOwned(userId, laneId);

    const seriesRows = await this.prisma.storySeries.findMany({
      where: { userId, laneId },
      select: { id: true, title: true },
    });
    const seriesIds = seriesRows.map((row) => row.id);

    const [scheduleCount, replacementCount, executionCount] = await this.prisma.$transaction(
      async (tx) => {
        // Clear active pointer first (unique FK to StorySeries).
        await tx.seriesLane.update({
          where: { id: laneId },
          data: { activeSeriesId: null },
        });

        const schedules = await tx.seriesSchedule.deleteMany({
          where: { userId, laneId },
        });
        const replacements = await tx.seriesReplacementPlan.deleteMany({
          where: { userId, laneId },
        });
        const executions = await tx.seriesExecution.deleteMany({
          where: { userId, laneId },
        });

        // StorySeries delete cascades: bible, characters, episodes (+ dialogue/shots/clips/schedules),
        // continuity, memory, production runs, replacement source rows.
        if (seriesIds.length > 0) {
          await tx.storySeries.deleteMany({
            where: { userId, laneId, id: { in: seriesIds } },
          });
        }

        const now = new Date();
        const nextPublishAt = computeNextPublishAt(now, before.timezone, before.publishTime);
        const nextProductionAt = computeNextProductionAt(
          now,
          before.timezone,
          before.publishTime,
          before.productionLeadTimeMinutes,
          before.preferredProductionTime,
        );

        await tx.seriesLane.update({
          where: { id: laneId },
          data: {
            activeSeriesId: null,
            currentEpisodeNumber: 0,
            lastPublishedEpisodeNumber: 0,
            lastPublishedAt: null,
            nextPublishAt,
            nextProductionAt,
            status: SeriesLaneStatus.PAUSED,
            pausedAt: new Date(),
            metadata: {
              ...((before.metadata as Record<string, unknown> | null) ?? {}),
              lastResetAt: new Date().toISOString(),
              lastResetSeriesCount: seriesIds.length,
            } as Prisma.InputJsonValue,
          },
        });

        return [schedules.count, replacements.count, executions.count] as const;
      },
    );

    const updated = await this.prisma.seriesLane.findFirstOrThrow({
      where: { id: laneId, userId },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(
      userId,
      'series.lane.reset',
      {
        activeSeriesId: before.activeSeriesId,
        seriesIds,
        seriesTitles: seriesRows.map((row) => row.title),
      },
      {
        deletedSeriesCount: seriesIds.length,
        deletedScheduleCount: scheduleCount,
        deletedReplacementCount: replacementCount,
        deletedExecutionCount: executionCount,
        laneStatus: updated.status,
      },
      laneId,
    );

    await this.notifications.notify({
      userId,
      type: SERIES_NOTIFICATION_TYPES.LANE_PAUSED,
      title: `${before.name} reset`,
      body: `Cleared ${seriesIds.length} movie(s) and related schedules. Lane is paused — Plan Movie when ready.`,
      dedupeKey: `series-lane-reset:${laneId}:${Date.now()}`,
      metadata: { laneId, deletedSeriesCount: seriesIds.length },
    }).catch(() => undefined);

    return {
      lane: this.serialize(updated),
      deleted: {
        seriesCount: seriesIds.length,
        seriesIds,
        scheduleCount,
        replacementCount,
        executionCount,
      },
    };
  }

  /**
   * Soft-delete a lane. MORNING/EVENING defaults cannot be deleted (pause/disable instead).
   * Story series rows remain owned by the lane FK; active pointer is cleared.
   */
  async softDelete(userId: string, laneId: string) {
    const before = await this.getOwned(userId, laneId);
    if (before.laneType !== SeriesLaneType.CUSTOM) {
      throw new BadRequestException(
        'Default morning/evening lanes cannot be deleted. Pause or disable them instead.',
      );
    }

    const updated = await this.prisma.seriesLane.update({
      where: { id: laneId },
      data: {
        deletedAt: new Date(),
        enabled: false,
        status: SeriesLaneStatus.DISABLED,
        activeSeriesId: null,
        pausedAt: new Date(),
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(userId, 'series.lane.delete', before, updated, laneId);
    return this.serialize(updated);
  }

  async pause(userId: string, laneId: string) {
    const before = await this.getOwned(userId, laneId);
    const updated = await this.prisma.seriesLane.update({
      where: { id: laneId },
      data: {
        status: SeriesLaneStatus.PAUSED,
        pausedAt: new Date(),
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(userId, 'series.lane.pause', before, updated, laneId);
    await this.notifications.notify({
      userId,
      type: SERIES_NOTIFICATION_TYPES.LANE_PAUSED,
      title: `${updated.name} paused`,
      body: `The ${updated.name} series lane is paused. Other lanes are unaffected. Existing assets are preserved.`,
      dedupeKey: `series-lane-paused:${updated.id}:${updated.pausedAt?.toISOString() ?? 'x'}`,
    });
    return this.serialize(updated);
  }

  async resume(userId: string, laneId: string) {
    const before = await this.getOwned(userId, laneId);
    if (!before.enabled) {
      throw new BadRequestException('Cannot resume a disabled lane; enable it first');
    }
    const updated = await this.prisma.seriesLane.update({
      where: { id: laneId },
      data: {
        status: SeriesLaneStatus.ACTIVE,
        pausedAt: null,
      },
      include: { activeSeries: { select: ACTIVE_SERIES_SELECT } },
    });

    await this.audit(userId, 'series.lane.resume', before, updated, laneId);
    await this.notifications.notify({
      userId,
      type: SERIES_NOTIFICATION_TYPES.LANE_RESUMED,
      title: `${updated.name} resumed`,
      body: `The ${updated.name} series lane is active again.`,
      dedupeKey: `series-lane-resumed:${updated.id}:${Date.now()}`,
    });
    return this.serialize(updated);
  }

  async syncEnabledFromConfig(
    userId: string,
    flags: { morning: boolean; evening: boolean },
  ) {
    await this.ensureDefaultLanes(userId);
    await this.prisma.seriesLane.updateMany({
      where: { userId, laneType: SeriesLaneType.MORNING, deletedAt: null },
      data: {
        enabled: flags.morning,
        ...(flags.morning
          ? {}
          : { status: SeriesLaneStatus.DISABLED, pausedAt: new Date() }),
      },
    });
    await this.prisma.seriesLane.updateMany({
      where: { userId, laneType: SeriesLaneType.EVENING, deletedAt: null },
      data: {
        enabled: flags.evening,
        ...(flags.evening
          ? {}
          : { status: SeriesLaneStatus.DISABLED, pausedAt: new Date() }),
      },
    });
  }

  /**
   * Lane may accept new scheduling/production work when enabled and ACTIVE.
   * Pausing one lane must not affect the other.
   */
  canLaneAcceptWork(lane: {
    enabled: boolean;
    status: SeriesLaneStatus;
    deletedAt?: Date | null;
  }): boolean {
    if (lane.deletedAt) return false;
    return lane.enabled && lane.status === SeriesLaneStatus.ACTIVE;
  }

  /**
   * Config morning/evening flags only gate MORNING/EVENING lanes.
   * CUSTOM lanes rely solely on their own enabled flag.
   */
  isLaneConfigEnabled(
    lane: { laneType: SeriesLaneType; enabled: boolean },
    config: { morningLaneEnabled: boolean; eveningLaneEnabled: boolean },
  ): boolean {
    if (!lane.enabled) return false;
    if (lane.laneType === SeriesLaneType.MORNING) return config.morningLaneEnabled;
    if (lane.laneType === SeriesLaneType.EVENING) return config.eveningLaneEnabled;
    return true;
  }

  serialize(
    lane: Prisma.SeriesLaneGetPayload<{
      include?: {
        activeSeries?: {
          select: typeof ACTIVE_SERIES_SELECT;
        };
      };
    }>,
  ) {
    return {
      ...lane,
      creativeSettings: parseSeriesCreativeSettings(lane.creativeSettings),
      publishingConfig: lane.publishingConfig ?? {},
      metadata: lane.metadata ?? {},
    };
  }

  private assertTimezone(timezone?: string) {
    if (!timezone) return;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${timezone}`);
    }
  }

  private async audit(
    userId: string,
    action: string,
    before: unknown,
    after: unknown,
    entityId: string,
  ) {
    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action,
        entityType: 'SeriesLane',
        entityId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
