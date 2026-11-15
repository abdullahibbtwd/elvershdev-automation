import { BadRequestException, Injectable } from '@nestjs/common';
import { AutomationRunMode, JobStatus, Prisma } from '@prisma/client';
import { AUTOMATION_DEFAULTS, AUTOMATION_NOTIFICATION_TYPES } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateAutomationConfigDto } from './dto/update-automation-config.dto';

@Injectable()
export class AutomationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getOrCreate(userId: string) {
    const existing = await this.prisma.automationConfig.findUnique({ where: { userId } });
    if (existing) return this.serialize(existing);

    const created = await this.prisma.automationConfig.create({
      data: {
        userId,
        enabled: false,
        runMode: AutomationRunMode.PAUSED,
        dailyGenerationTarget: AUTOMATION_DEFAULTS.dailyGenerationTarget,
        monthlyGenerationTarget: AUTOMATION_DEFAULTS.monthlyGenerationTarget,
        timezone: AUTOMATION_DEFAULTS.timezone,
        preferredPublishingDays: [...AUTOMATION_DEFAULTS.preferredPublishingDays],
        includeWeekends: AUTOMATION_DEFAULTS.includeWeekends,
        publishingWindowStart: AUTOMATION_DEFAULTS.publishingWindowStart,
        publishingWindowEnd: AUTOMATION_DEFAULTS.publishingWindowEnd,
        platformPublishingTimes: {},
        minIntervalMinutes: AUTOMATION_DEFAULTS.minIntervalMinutes,
        maxDailyPublishingAttempts: AUTOMATION_DEFAULTS.maxDailyPublishingAttempts,
        channelPublishingEnabled: AUTOMATION_DEFAULTS.channelPublishingEnabled,
        contentCategories: [...AUTOMATION_DEFAULTS.contentCategories],
        storyGenres: [...AUTOMATION_DEFAULTS.storyGenres],
        language: AUTOMATION_DEFAULTS.language,
        targetDurationSeconds: AUTOMATION_DEFAULTS.targetDurationSeconds,
        maxConcurrentGeneration: AUTOMATION_DEFAULTS.maxConcurrentGeneration,
        maxConcurrentPublishing: AUTOMATION_DEFAULTS.maxConcurrentPublishing,
        maxRetries: AUTOMATION_DEFAULTS.maxRetries,
        maxGenerationAttempts: AUTOMATION_DEFAULTS.maxGenerationAttempts,
        maxImageGenerationsPerScene: AUTOMATION_DEFAULTS.maxImageGenerationsPerScene,
        maxMotionAttemptsPerScene: AUTOMATION_DEFAULTS.maxMotionAttemptsPerScene,
      },
    });
    return this.serialize(created);
  }

  async update(userId: string, dto: UpdateAutomationConfigDto) {
    await this.getOrCreate(userId);
    if (dto.timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException(`Invalid timezone: ${dto.timezone}`);
      }
    }

    const before = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.automationConfig.update({
      where: { userId },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.dailyGenerationTarget !== undefined
          ? { dailyGenerationTarget: dto.dailyGenerationTarget }
          : {}),
        ...(dto.monthlyGenerationTarget !== undefined
          ? { monthlyGenerationTarget: dto.monthlyGenerationTarget }
          : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.preferredPublishingDays !== undefined
          ? { preferredPublishingDays: dto.preferredPublishingDays }
          : {}),
        ...(dto.includeWeekends !== undefined ? { includeWeekends: dto.includeWeekends } : {}),
        ...(dto.publishingWindowStart !== undefined
          ? { publishingWindowStart: dto.publishingWindowStart }
          : {}),
        ...(dto.publishingWindowEnd !== undefined
          ? { publishingWindowEnd: dto.publishingWindowEnd }
          : {}),
        ...(dto.platformPublishingTimes !== undefined
          ? { platformPublishingTimes: dto.platformPublishingTimes as Prisma.InputJsonValue }
          : {}),
        ...(dto.minIntervalMinutes !== undefined
          ? { minIntervalMinutes: dto.minIntervalMinutes }
          : {}),
        ...(dto.maxDailyPublishingAttempts !== undefined
          ? { maxDailyPublishingAttempts: dto.maxDailyPublishingAttempts }
          : {}),
        ...(dto.channelPublishingEnabled !== undefined
          ? { channelPublishingEnabled: dto.channelPublishingEnabled as Prisma.InputJsonValue }
          : {}),
        ...(dto.activeChannelIds !== undefined ? { activeChannelIds: dto.activeChannelIds } : {}),
        ...(dto.contentCategories !== undefined
          ? { contentCategories: dto.contentCategories }
          : {}),
        ...(dto.storyGenres !== undefined ? { storyGenres: dto.storyGenres } : {}),
        ...(dto.themes !== undefined ? { themes: dto.themes } : {}),
        ...(dto.targetAudience !== undefined ? { targetAudience: dto.targetAudience } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
        ...(dto.targetDurationSeconds !== undefined
          ? { targetDurationSeconds: dto.targetDurationSeconds }
          : {}),
        ...(dto.visualStyleId !== undefined ? { visualStyleId: dto.visualStyleId } : {}),
        ...(dto.narrationVoiceId !== undefined ? { narrationVoiceId: dto.narrationVoiceId } : {}),
        ...(dto.contentExclusions !== undefined
          ? { contentExclusions: dto.contentExclusions }
          : {}),
        ...(dto.brandIdentity !== undefined ? { brandIdentity: dto.brandIdentity } : {}),
        ...(dto.maxConcurrentGeneration !== undefined
          ? { maxConcurrentGeneration: dto.maxConcurrentGeneration }
          : {}),
        ...(dto.maxConcurrentPublishing !== undefined
          ? { maxConcurrentPublishing: dto.maxConcurrentPublishing }
          : {}),
        ...(dto.maxRetries !== undefined ? { maxRetries: dto.maxRetries } : {}),
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
        ...(dto.maxCostPerVideoUsd !== undefined
          ? {
              maxCostPerVideoUsd:
                dto.maxCostPerVideoUsd === null
                  ? null
                  : new Prisma.Decimal(dto.maxCostPerVideoUsd),
            }
          : {}),
        ...(dto.maxGenerationAttempts !== undefined
          ? { maxGenerationAttempts: dto.maxGenerationAttempts }
          : {}),
        ...(dto.maxImageGenerationsPerScene !== undefined
          ? { maxImageGenerationsPerScene: dto.maxImageGenerationsPerScene }
          : {}),
        ...(dto.maxMotionAttemptsPerScene !== undefined
          ? { maxMotionAttemptsPerScene: dto.maxMotionAttemptsPerScene }
          : {}),
      },
    });

    await this.audit(userId, 'config.update', before, updated);
    return this.serialize(updated);
  }

  async enable(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.automationConfig.update({
      where: { userId },
      data: {
        enabled: true,
        runMode: AutomationRunMode.ENABLED,
        pausedAt: null,
        emergencyStopAt: null,
      },
    });
    await this.audit(userId, 'config.enable', before, updated);
    return this.serialize(updated);
  }

  async pause(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.automationConfig.update({
      where: { userId },
      data: {
        runMode: AutomationRunMode.PAUSED,
        pausedAt: new Date(),
      },
    });
    await this.audit(userId, 'config.pause', before, updated);
    await this.notifications.notify({
      userId,
      type: AUTOMATION_NOTIFICATION_TYPES.PAUSED_OR_BLOCKED,
      title: 'Automation paused',
      body: 'New scheduling is paused. In-flight jobs may finish. Scheduled content was preserved.',
      dedupeKey: `automation-paused:${updated.id}:${updated.pausedAt?.toISOString() ?? 'x'}`,
    });
    return this.serialize(updated);
  }

  async resume(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.automationConfig.update({
      where: { userId },
      data: {
        enabled: true,
        runMode: AutomationRunMode.ENABLED,
        pausedAt: null,
        emergencyStopAt: null,
      },
    });
    await this.audit(userId, 'config.resume', before, updated);
    return this.serialize(updated);
  }

  async emergencyStop(userId: string) {
    await this.getOrCreate(userId);
    const before = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const updated = await this.prisma.automationConfig.update({
      where: { userId },
      data: {
        runMode: AutomationRunMode.EMERGENCY_STOP,
        emergencyStopAt: new Date(),
        pausedAt: new Date(),
      },
    });
    await this.audit(userId, 'config.emergency_stop', before, updated);
    // Cancel this user's cancellable queued work; running work is marked interrupted honestly.
    const queued = await this.prisma.generationJob.findMany({
      where: {
        userId,
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED] },
      },
      take: 200,
    });
    for (const job of queued) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Cancelled by user emergency stop',
        },
      });
    }
    const processing = await this.prisma.generationJob.updateMany({
      where: { userId, status: JobStatus.PROCESSING },
      data: {
        status: JobStatus.INTERRUPTED,
        completedAt: new Date(),
        errorMessage:
          'Interrupted by user emergency stop; external provider work may still be running',
      },
    });

    await this.notifications.notify({
      userId,
      type: AUTOMATION_NOTIFICATION_TYPES.PAUSED_OR_BLOCKED,
      title: 'Emergency stop activated',
      body:
        `No new generation or publishing jobs will be scheduled. Cancelled ${queued.length} queued job(s). ` +
        `${processing.count} running job(s) marked interrupted (external provider work may still complete).`,
      dedupeKey: `automation-emergency:${updated.id}:${updated.emergencyStopAt?.toISOString() ?? 'x'}`,
    });
    return this.serialize(updated);
  }

  canScheduleNewWork(config: { enabled: boolean; runMode: AutomationRunMode }): boolean {
    return config.enabled && config.runMode === AutomationRunMode.ENABLED;
  }

  serialize(config: Prisma.AutomationConfigGetPayload<object>) {
    return {
      ...config,
      dailyBudgetUsd: config.dailyBudgetUsd != null ? Number(config.dailyBudgetUsd) : null,
      monthlyBudgetUsd: config.monthlyBudgetUsd != null ? Number(config.monthlyBudgetUsd) : null,
      maxCostPerVideoUsd:
        config.maxCostPerVideoUsd != null ? Number(config.maxCostPerVideoUsd) : null,
      platformPublishingTimes: config.platformPublishingTimes ?? {},
      channelPublishingEnabled: config.channelPublishingEnabled ?? {},
    };
  }

  private async audit(userId: string, action: string, before: unknown, after: unknown) {
    await this.prisma.automationAuditLog.create({
      data: {
        userId,
        action,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
