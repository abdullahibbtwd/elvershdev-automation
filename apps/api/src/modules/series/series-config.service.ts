import { BadRequestException, Injectable } from '@nestjs/common';
import { AutomationRunMode, Prisma, SeriesAutonomyMode } from '@prisma/client';
import {
  SERIES_DEFAULTS,
  parseSeriesCreativeSettings,
  resolveSeriesAutonomyPolicy,
  seriesCreativeSettingsSchema,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSeriesConfigDto } from './dto/update-series-config.dto';
import { SeriesLaneService } from './series-lane.service';

@Injectable()
export class SeriesConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lanes: SeriesLaneService,
  ) {}

  async getOrCreate(userId: string) {
    const existing = await this.prisma.seriesAutomationConfig.findUnique({ where: { userId } });
    if (existing) {
      await this.lanes.ensureDefaultLanes(userId);
      return this.serialize(existing);
    }

    const created = await this.prisma.seriesAutomationConfig.create({
      data: {
        userId,
        seriesStudioEnabled: false,
        runMode: AutomationRunMode.PAUSED,
        morningLaneEnabled: true,
        eveningLaneEnabled: true,
        automaticMoviePlanning: true,
        automaticEpisodeProduction: SERIES_DEFAULTS.automaticEpisodeProduction,
        automaticCharacterGeneration: true,
        automaticEpisodeScriptGeneration: true,
        automaticVisualGeneration: true,
        automaticMotionGeneration: SERIES_DEFAULTS.automaticMotionGeneration,
        automaticNarration: true,
        automaticRendering: true,
        automaticPublishing: false,
        automaticReplacementPlanning: true,
        automaticReplacementApproval: SERIES_DEFAULTS.automaticReplacementApproval,
        episodeApprovalRequired: SERIES_DEFAULTS.episodeApprovalRequired,
        movieApprovalRequired: SERIES_DEFAULTS.movieApprovalRequired,
        autonomyMode: SeriesAutonomyMode.MANUAL,
        startMediaAfterMoviePlanning: SERIES_DEFAULTS.startMediaAfterMoviePlanning,
        defaultProductionStartMode: SERIES_DEFAULTS.defaultProductionStartMode,
        defaultProductionLeadTimeMinutes: SERIES_DEFAULTS.defaultProductionLeadTimeMinutes,
        defaultPlannedEpisodeCount: SERIES_DEFAULTS.plannedEpisodeCount,
        defaultEpisodeDurationSeconds: SERIES_DEFAULTS.targetEpisodeDurationSeconds,
        defaultStoryDurationSeconds: null,
        defaultMaxClipDurationSeconds: SERIES_DEFAULTS.maxClipDurationSeconds,
        defaultProductionFormat: SERIES_DEFAULTS.productionFormat,
        defaultReplacementTriggerEpisode: SERIES_DEFAULTS.replacementTriggerEpisode,
        maxConcurrentEpisodeProduction: SERIES_DEFAULTS.maxConcurrentEpisodeProduction,
        maxRetries: SERIES_DEFAULTS.maxRetries,
        qualityAcceptanceThreshold: SERIES_DEFAULTS.qualityAcceptanceThreshold,
        language: SERIES_DEFAULTS.language,
        tone: SERIES_DEFAULTS.tone,
        visualDirection: SERIES_DEFAULTS.visualDirection,
        channelPublishingEnabled: {
          FACEBOOK: true,
          INSTAGRAM: true,
          TIKTOK: true,
          YOUTUBE: true,
        },
      },
    });

    await this.lanes.ensureDefaultLanes(userId);
    await this.audit(userId, 'series.config.create', null, created);
    return this.serialize(created);
  }

  async update(userId: string, dto: UpdateSeriesConfigDto) {
    await this.getOrCreate(userId);
    const before = await this.prisma.seriesAutomationConfig.findUniqueOrThrow({ where: { userId } });

    const planned =
      dto.defaultPlannedEpisodeCount ?? before.defaultPlannedEpisodeCount;
    const trigger =
      dto.defaultReplacementTriggerEpisode ?? before.defaultReplacementTriggerEpisode;
    if (trigger > planned) {
      throw new BadRequestException(
        'Replacement trigger episode cannot exceed planned episode count',
      );
    }

    const updated = await this.prisma.seriesAutomationConfig.update({
      where: { userId },
      data: {
        ...(dto.seriesStudioEnabled !== undefined
          ? { seriesStudioEnabled: dto.seriesStudioEnabled }
          : {}),
        ...(dto.morningLaneEnabled !== undefined
          ? { morningLaneEnabled: dto.morningLaneEnabled }
          : {}),
        ...(dto.eveningLaneEnabled !== undefined
          ? { eveningLaneEnabled: dto.eveningLaneEnabled }
          : {}),
        ...(dto.automaticMoviePlanning !== undefined
          ? { automaticMoviePlanning: dto.automaticMoviePlanning }
          : {}),
        ...(dto.automaticEpisodeProduction !== undefined
          ? { automaticEpisodeProduction: dto.automaticEpisodeProduction }
          : {}),
        ...(dto.automaticCharacterGeneration !== undefined
          ? { automaticCharacterGeneration: dto.automaticCharacterGeneration }
          : {}),
        ...(dto.automaticEpisodeScriptGeneration !== undefined
          ? { automaticEpisodeScriptGeneration: dto.automaticEpisodeScriptGeneration }
          : {}),
        ...(dto.automaticVisualGeneration !== undefined
          ? { automaticVisualGeneration: dto.automaticVisualGeneration }
          : {}),
        ...(dto.automaticMotionGeneration !== undefined
          ? { automaticMotionGeneration: dto.automaticMotionGeneration }
          : {}),
        ...(dto.automaticNarration !== undefined
          ? { automaticNarration: dto.automaticNarration }
          : {}),
        ...(dto.automaticRendering !== undefined
          ? { automaticRendering: dto.automaticRendering }
          : {}),
        ...(dto.automaticPublishing !== undefined
          ? { automaticPublishing: dto.automaticPublishing }
          : {}),
        ...(dto.automaticReplacementPlanning !== undefined
          ? { automaticReplacementPlanning: dto.automaticReplacementPlanning }
          : {}),
        ...(dto.automaticReplacementApproval !== undefined
          ? { automaticReplacementApproval: dto.automaticReplacementApproval }
          : {}),
        ...(dto.episodeApprovalRequired !== undefined
          ? { episodeApprovalRequired: dto.episodeApprovalRequired }
          : {}),
        ...(dto.movieApprovalRequired !== undefined
          ? { movieApprovalRequired: dto.movieApprovalRequired }
          : {}),
        ...(dto.autonomyMode !== undefined
          ? { autonomyMode: dto.autonomyMode as SeriesAutonomyMode }
          : {}),
        ...(dto.startMediaAfterMoviePlanning !== undefined
          ? { startMediaAfterMoviePlanning: dto.startMediaAfterMoviePlanning }
          : {}),
        ...(dto.defaultProductionStartMode !== undefined
          ? { defaultProductionStartMode: dto.defaultProductionStartMode }
          : {}),
        ...(dto.defaultProductionLeadTimeMinutes !== undefined
          ? { defaultProductionLeadTimeMinutes: dto.defaultProductionLeadTimeMinutes }
          : {}),
        ...(dto.defaultPlannedEpisodeCount !== undefined
          ? { defaultPlannedEpisodeCount: dto.defaultPlannedEpisodeCount }
          : {}),
        ...(dto.defaultEpisodeDurationSeconds !== undefined
          ? { defaultEpisodeDurationSeconds: dto.defaultEpisodeDurationSeconds }
          : {}),
        ...(dto.defaultStoryDurationSeconds !== undefined
          ? { defaultStoryDurationSeconds: dto.defaultStoryDurationSeconds }
          : {}),
        ...(dto.defaultMaxClipDurationSeconds !== undefined
          ? { defaultMaxClipDurationSeconds: dto.defaultMaxClipDurationSeconds }
          : {}),
        ...(dto.defaultProductionFormat !== undefined
          ? { defaultProductionFormat: dto.defaultProductionFormat }
          : {}),
        ...(dto.defaultReplacementTriggerEpisode !== undefined
          ? { defaultReplacementTriggerEpisode: dto.defaultReplacementTriggerEpisode }
          : {}),
        ...(dto.maxConcurrentEpisodeProduction !== undefined
          ? { maxConcurrentEpisodeProduction: dto.maxConcurrentEpisodeProduction }
          : {}),
        ...(dto.maxRetries !== undefined ? { maxRetries: dto.maxRetries } : {}),
        ...(dto.qualityAcceptanceThreshold !== undefined
          ? { qualityAcceptanceThreshold: dto.qualityAcceptanceThreshold }
          : {}),
        ...(dto.language !== undefined ? { language: dto.language.trim() || 'en' } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone.trim() || SERIES_DEFAULTS.tone } : {}),
        ...(dto.visualDirection !== undefined
          ? { visualDirection: dto.visualDirection.trim() || SERIES_DEFAULTS.visualDirection }
          : {}),
        ...(dto.visualStyleId !== undefined ? { visualStyleId: dto.visualStyleId } : {}),
        ...(dto.narrationVoiceId !== undefined ? { narrationVoiceId: dto.narrationVoiceId } : {}),
        ...(dto.activeChannelIds !== undefined ? { activeChannelIds: dto.activeChannelIds } : {}),
        ...(dto.channelPublishingEnabled !== undefined
          ? { channelPublishingEnabled: dto.channelPublishingEnabled as Prisma.InputJsonValue }
          : {}),
        ...(dto.dailyBudgetUsd !== undefined
          ? {
              dailyBudgetUsd:
                dto.dailyBudgetUsd === null ? null : new Prisma.Decimal(dto.dailyBudgetUsd),
            }
          : {}),
        ...(dto.monthlyBudgetUsd !== undefined
          ? {
              monthlyBudgetUsd:
                dto.monthlyBudgetUsd === null ? null : new Prisma.Decimal(dto.monthlyBudgetUsd),
            }
          : {}),
        ...(dto.maxCostPerEpisodeUsd !== undefined
          ? {
              maxCostPerEpisodeUsd:
                dto.maxCostPerEpisodeUsd === null
                  ? null
                  : new Prisma.Decimal(dto.maxCostPerEpisodeUsd),
            }
          : {}),
        ...(dto.creativeSettings !== undefined
          ? {
              creativeSettings: (() => {
                const parsed = seriesCreativeSettingsSchema.safeParse(
                  dto.creativeSettings,
                );
                if (!parsed.success) {
                  const details = parsed.error.issues
                    .map(
                      (issue) =>
                        `${issue.path.join('.') || 'creativeSettings'}: ${issue.message}`,
                    )
                    .join('; ');
                  throw new BadRequestException(
                    `Invalid creative settings — ${details}`,
                  );
                }
                return parsed.data as Prisma.InputJsonValue;
              })(),
            }
          : {}),
      },
    });

    // Sync global lane enable flags onto lane rows without touching the other lane's pause state.
    if (dto.morningLaneEnabled !== undefined || dto.eveningLaneEnabled !== undefined) {
      await this.lanes.syncEnabledFromConfig(userId, {
        morning: updated.morningLaneEnabled,
        evening: updated.eveningLaneEnabled,
      });
    }

    // Keep lane duration columns aligned with Production settings so Plan Movie
    // does not keep using stale 60s / 10-episode lane defaults.
    const durationPatch: {
      plannedEpisodeCount?: number;
      targetEpisodeDurationSeconds?: number;
      targetStoryDurationSeconds?: number | null;
      maxClipDurationSeconds?: number;
      productionFormat?: string;
      replacementTriggerEpisode?: number;
    } = {};
    if (dto.defaultPlannedEpisodeCount !== undefined) {
      durationPatch.plannedEpisodeCount = updated.defaultPlannedEpisodeCount;
    }
    if (dto.defaultEpisodeDurationSeconds !== undefined) {
      durationPatch.targetEpisodeDurationSeconds = updated.defaultEpisodeDurationSeconds;
    }
    if (dto.defaultStoryDurationSeconds !== undefined) {
      durationPatch.targetStoryDurationSeconds = updated.defaultStoryDurationSeconds;
    }
    if (dto.defaultMaxClipDurationSeconds !== undefined) {
      durationPatch.maxClipDurationSeconds = updated.defaultMaxClipDurationSeconds;
    }
    if (dto.defaultProductionFormat !== undefined) {
      durationPatch.productionFormat = updated.defaultProductionFormat;
    }
    if (
      dto.defaultReplacementTriggerEpisode !== undefined ||
      dto.defaultPlannedEpisodeCount !== undefined
    ) {
      const planned =
        durationPatch.plannedEpisodeCount ?? updated.defaultPlannedEpisodeCount;
      const trigger =
        dto.defaultReplacementTriggerEpisode !== undefined
          ? updated.defaultReplacementTriggerEpisode
          : undefined;
      durationPatch.replacementTriggerEpisode = Math.min(
        Math.max(1, trigger ?? updated.defaultReplacementTriggerEpisode),
        planned,
      );
    }
    if (Object.keys(durationPatch).length > 0) {
      await this.prisma.seriesLane.updateMany({
        where: { userId, deletedAt: null },
        data: durationPatch,
      });
    }

    await this.audit(userId, 'series.config.update', before, updated);
    return this.serialize(updated);
  }

  async enable(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.seriesAutomationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.seriesAutomationConfig.update({
      where: { userId },
      data: {
        seriesStudioEnabled: true,
        runMode: AutomationRunMode.ENABLED,
        pausedAt: null,
        emergencyStopAt: null,
      },
    });
    await this.audit(userId, 'series.config.enable', before, updated);
    return this.serialize(updated);
  }

  async pause(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.seriesAutomationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.seriesAutomationConfig.update({
      where: { userId },
      data: {
        runMode: AutomationRunMode.PAUSED,
        pausedAt: new Date(),
      },
    });
    await this.audit(userId, 'series.config.pause', before, updated);
    return this.serialize(updated);
  }

  async resume(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.seriesAutomationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.seriesAutomationConfig.update({
      where: { userId },
      data: {
        seriesStudioEnabled: true,
        runMode: AutomationRunMode.ENABLED,
        pausedAt: null,
        emergencyStopAt: null,
      },
    });
    await this.audit(userId, 'series.config.resume', before, updated);
    return this.serialize(updated);
  }

  async emergencyStop(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.seriesAutomationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.seriesAutomationConfig.update({
      where: { userId },
      data: {
        runMode: AutomationRunMode.EMERGENCY_STOP,
        emergencyStopAt: new Date(),
        pausedAt: new Date(),
      },
    });
    await this.audit(userId, 'series.config.emergency_stop', before, updated);
    return this.serialize(updated);
  }

  /** Gates whether Series Studio may enqueue any new work. */
  canScheduleNewWork(config: {
    seriesStudioEnabled: boolean;
    runMode: AutomationRunMode;
  }): boolean {
    return config.seriesStudioEnabled && config.runMode === AutomationRunMode.ENABLED;
  }

  serialize(config: Prisma.SeriesAutomationConfigGetPayload<object>) {
    const autonomy = resolveSeriesAutonomyPolicy({
      autonomyMode: config.autonomyMode,
      movieApprovalRequired: config.movieApprovalRequired,
      episodeApprovalRequired: config.episodeApprovalRequired,
      automaticReplacementApproval: config.automaticReplacementApproval,
    });
    return {
      ...config,
      dailyBudgetUsd: config.dailyBudgetUsd != null ? Number(config.dailyBudgetUsd) : null,
      monthlyBudgetUsd: config.monthlyBudgetUsd != null ? Number(config.monthlyBudgetUsd) : null,
      maxCostPerEpisodeUsd:
        config.maxCostPerEpisodeUsd != null ? Number(config.maxCostPerEpisodeUsd) : null,
      channelPublishingEnabled: config.channelPublishingEnabled ?? {},
      creativeSettings: parseSeriesCreativeSettings(config.creativeSettings),
      autonomyMode: autonomy.autonomyMode,
      fullyAutonomous: autonomy.fullyAutonomous,
      autonomyOverridesApprovals: autonomy.autonomyOverridesApprovals,
      overriddenByAutonomy: [...autonomy.overriddenByAutonomy],
      effectiveMovieApprovalRequired: autonomy.effectiveMovieApprovalRequired,
      effectiveEpisodeApprovalRequired: autonomy.effectiveEpisodeApprovalRequired,
      effectiveAutomaticReplacementApproval: autonomy.effectiveAutomaticReplacementApproval,
    };
  }

  private async audit(userId: string, action: string, before: unknown, after: unknown) {
    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action,
        entityType: 'SeriesAutomationConfig',
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
