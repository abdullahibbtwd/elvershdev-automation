import { Injectable } from '@nestjs/common';
import {
  ContentScheduleStatus,
  ScheduledPublicationStatus,
  SocialConnectionStatus,
} from '@prisma/client';
import { formatDateInTimeZone, getZonedParts } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationBudgetService } from './automation-budget.service';
import { AutomationConfigService } from './automation-config.service';

@Injectable()
export class AutomationDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AutomationConfigService,
    private readonly budgetService: AutomationBudgetService,
  ) {}

  async getDashboard(userId: string) {
    const config = await this.configService.getOrCreate(userId);
    const spend = await this.budgetService.getSpend(userId, config.timezone);
    const today = formatDateInTimeZone(new Date(), config.timezone);
    const todayDate = new Date(today);
    const parts = getZonedParts(new Date(), config.timezone);
    const monthStart = new Date(`${parts.year}-${String(parts.month).padStart(2, '0')}-01`);

    const [
      plannedToday,
      generating,
      completedRenders,
      scheduledPublications,
      successfulPublications,
      failedPublications,
      monthlyGenerated,
      channels,
      failedSchedules,
      upcomingPublications,
    ] = await Promise.all([
      this.prisma.contentPlan.count({
        where: { userId, plannedDate: todayDate, status: { not: 'CANCELLED' } },
      }),
      this.prisma.contentSchedule.findMany({
        where: {
          userId,
          status: {
            in: [
              ContentScheduleStatus.QUEUED,
              ContentScheduleStatus.GENERATING,
              ContentScheduleStatus.RENDERING,
            ],
          },
        },
        include: { contentPlan: true },
        take: 20,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.contentSchedule.count({
        where: {
          userId,
          videoRenderId: { not: null },
          status: {
            in: [
              ContentScheduleStatus.READY,
              ContentScheduleStatus.SCHEDULING_PUBLISH,
              ContentScheduleStatus.PUBLISHING,
              ContentScheduleStatus.COMPLETED,
            ],
          },
          updatedAt: {
            gte: new Date(`${today}T00:00:00.000Z`),
          },
        },
      }),
      this.prisma.scheduledPublication.count({
        where: {
          userId,
          status: {
            in: [ScheduledPublicationStatus.SCHEDULED, ScheduledPublicationStatus.QUEUED],
          },
        },
      }),
      this.prisma.scheduledPublication.count({
        where: { userId, status: ScheduledPublicationStatus.PUBLISHED },
      }),
      this.prisma.scheduledPublication.count({
        where: {
          userId,
          status: {
            in: [ScheduledPublicationStatus.FAILED, ScheduledPublicationStatus.INELIGIBLE],
          },
        },
      }),
      this.prisma.contentPlan.count({
        where: {
          userId,
          plannedDate: { gte: monthStart },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.socialChannel.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          platform: true,
          accountName: true,
          connectionStatus: true,
        },
      }),
      this.prisma.contentSchedule.findMany({
        where: {
          userId,
          status: {
            in: [
              ContentScheduleStatus.FAILED,
              ContentScheduleStatus.BUDGET_BLOCKED,
            ],
          },
        },
        include: { contentPlan: true },
        take: 20,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.scheduledPublication.findMany({
        where: {
          userId,
          status: {
            in: [ScheduledPublicationStatus.SCHEDULED, ScheduledPublicationStatus.QUEUED],
          },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }),
    ]);

    const blockers: string[] = [];
    if (!config.enabled) blockers.push('Automation disabled');
    if (config.runMode === 'PAUSED') blockers.push('Automation paused');
    if (config.runMode === 'EMERGENCY_STOP') blockers.push('Emergency stop active');
    if (
      config.dailyBudgetUsd != null &&
      spend.dailyUsd >= Number(config.dailyBudgetUsd)
    ) {
      blockers.push('Daily budget limit reached');
    }
    if (
      config.monthlyBudgetUsd != null &&
      spend.monthlyUsd >= Number(config.monthlyBudgetUsd)
    ) {
      blockers.push('Monthly budget limit reached');
    }
    const credentialIssueStatuses: SocialConnectionStatus[] = [
      SocialConnectionStatus.EXPIRED,
      SocialConnectionStatus.REVOKED,
      SocialConnectionStatus.MISSING_PERMISSIONS,
      SocialConnectionStatus.ERROR,
    ];
    const credentialIssues = channels.filter((channel) =>
      credentialIssueStatuses.includes(channel.connectionStatus),
    );
    if (credentialIssues.length) {
      blockers.push('Missing or expired social credentials');
    }
    const ineligibleStatuses: SocialConnectionStatus[] = [
      SocialConnectionStatus.NOT_ELIGIBLE,
      SocialConnectionStatus.DISCONNECTED,
    ];
    const ineligible = channels.filter((channel) =>
      ineligibleStatuses.includes(channel.connectionStatus),
    );
    if (ineligible.length && channels.length === ineligible.length) {
      blockers.push('Blocked by platform restrictions');
    }
    if (failedSchedules.length) blockers.push('Experiencing failures');

    let operationalStatus:
      | 'RUNNING'
      | 'PAUSED'
      | 'WAITING'
      | 'BLOCKED'
      | 'EMERGENCY_STOP'
      | 'DISABLED' = 'WAITING';
    if (!config.enabled) operationalStatus = 'DISABLED';
    else if (config.runMode === 'EMERGENCY_STOP') operationalStatus = 'EMERGENCY_STOP';
    else if (config.runMode === 'PAUSED') operationalStatus = 'PAUSED';
    else if (blockers.some((b) => b.includes('budget') || b.includes('credentials') || b.includes('platform')))
      operationalStatus = 'BLOCKED';
    else if (generating.length > 0) operationalStatus = 'RUNNING';
    else operationalStatus = 'WAITING';

    const estimatedMonthlyCost =
      monthlyGenerated > 0
        ? Number(((spend.monthlyUsd / Math.max(monthlyGenerated, 1)) * config.monthlyGenerationTarget).toFixed(2))
        : null;

    return {
      operationalStatus,
      blockers,
      config,
      today: {
        date: today,
        generationTarget: config.dailyGenerationTarget,
        planned: plannedToday,
        progress: Math.min(100, Math.round((plannedToday / Math.max(config.dailyGenerationTarget, 1)) * 100)),
      },
      generating,
      completedRendersToday: completedRenders,
      scheduledPublications,
      successfulPublications,
      failedPublications,
      monthlyGenerationCount: monthlyGenerated,
      monthlyGenerationTarget: config.monthlyGenerationTarget,
      spend,
      estimatedMonthlyProviderCostUsd: estimatedMonthlyCost,
      estimatedMonthlyProviderCostNote:
        'Estimate extrapolated from ProviderUsage.estimatedCost and monthly generation target. Not a billing invoice.',
      channels,
      credentialIssues,
      failedTasks: failedSchedules,
      upcomingPublications,
    };
  }
}
