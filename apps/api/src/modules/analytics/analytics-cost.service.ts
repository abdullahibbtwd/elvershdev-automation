import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ANALYTICS_NOTIFICATION_TYPES } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationBudgetService } from '../automation/automation-budget.service';

@Injectable()
export class AnalyticsCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AutomationBudgetService,
    private readonly notifications: NotificationsService,
  ) {}

  async summarize(userId: string, from: Date, to: Date) {
    const rows = await this.uniqueUsage(userId, from, to);
    const totalUsd = rows.reduce((sum, row) => sum + Number(row.estimatedCost), 0);
    const byProvider = this.group(rows, (row) => row.provider);
    const byStage = this.group(rows, (row) => row.requestType);
    const byDay = this.group(rows, (row) => row.createdAt.toISOString().slice(0, 10));
    const byMonth = this.group(rows, (row) => row.createdAt.toISOString().slice(0, 7));
    return {
      totalUsd,
      usageRecordCount: rows.length,
      isEstimate: true,
      byProvider,
      byStage,
      byDay,
      byMonth,
      recommendations: this.recommendations(rows),
    };
  }

  async providers(userId: string, from: Date, to: Date) {
    const rows = await this.uniqueUsage(userId, from, to);
    return Object.entries(this.group(rows, (row) => `${row.provider}:${row.model}`))
      .map(([providerModel, costUsd]) => ({ providerModel, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }

  async videos(userId: string, from: Date, to: Date) {
    const videos = await this.prisma.videoAnalytics.findMany({
      where: { userId, createdAt: { gte: from, lte: to } },
      orderBy: { totalProductionCostUsd: 'desc' },
    });
    const config = await this.prisma.automationConfig.findUnique({ where: { userId } });
    const limit = config?.maxCostPerVideoUsd ? Number(config.maxCostPerVideoUsd) : null;
    if (limit != null) {
      for (const video of videos.filter((row) => Number(row.totalProductionCostUsd) > limit)) {
        await this.notifications.notify({
          userId,
          type: ANALYTICS_NOTIFICATION_TYPES.EXPENSIVE_VIDEO,
          title: 'Video exceeded cost target',
          body: `${video.title ?? 'A video'} cost an estimated $${Number(video.totalProductionCostUsd).toFixed(2)}.`,
          dedupeKey: `analytics:expensive-video:${video.videoRenderId}`,
          metadata: { videoRenderId: video.videoRenderId, limitUsd: limit },
        });
      }
    }
    return videos.map((video) => ({
      videoRenderId: video.videoRenderId,
      title: video.title,
      costUsd: Number(video.totalProductionCostUsd),
      isEstimate: video.costIsEstimate,
    }));
  }

  async projection(userId: string) {
    const config = await this.prisma.automationConfig.findUnique({ where: { userId } });
    const timezone = config?.timezone ?? 'UTC';
    const spend = await this.budget.getSpend(userId, timezone);
    const now = new Date();
    const daysElapsed = Math.max(1, now.getUTCDate());
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projectedMonthlyUsd = (spend.monthlyUsd / daysElapsed) * daysInMonth;
    const monthlyLimitUsd = config?.monthlyBudgetUsd ? Number(config.monthlyBudgetUsd) : null;
    if (monthlyLimitUsd != null && spend.monthlyUsd >= monthlyLimitUsd * 0.8) {
      await this.notifications.notify({
        userId,
        type: ANALYTICS_NOTIFICATION_TYPES.SPENDING_THRESHOLD,
        title: 'Monthly spending threshold reached',
        body: `Estimated monthly spend has reached $${spend.monthlyUsd.toFixed(2)} of $${monthlyLimitUsd.toFixed(2)}.`,
        dedupeKey: `analytics:spending-threshold:${userId}:${now.toISOString().slice(0, 7)}`,
        metadata: { spendUsd: spend.monthlyUsd, monthlyLimitUsd },
      });
    }
    if (monthlyLimitUsd != null && projectedMonthlyUsd > monthlyLimitUsd) {
      await this.notifications.notify({
        userId,
        type: ANALYTICS_NOTIFICATION_TYPES.MONTHLY_PROJECTION_EXCEEDED,
        title: 'Projected monthly spend exceeds budget',
        body: `Projected spend is $${projectedMonthlyUsd.toFixed(2)} against a $${monthlyLimitUsd.toFixed(2)} limit.`,
        dedupeKey: `analytics:projection:${userId}:${now.toISOString().slice(0, 7)}`,
        metadata: { projectedMonthlyUsd, monthlyLimitUsd },
      });
    }
    return { ...spend, projectedMonthlyUsd, monthlyLimitUsd, isEstimate: true };
  }

  private async uniqueUsage(userId: string, from: Date, to: Date) {
    const rows = await this.prisma.providerUsage.findMany({
      where: { userId, createdAt: { gte: from, lte: to } },
      select: {
        id: true, provider: true, model: true, requestType: true, estimatedCost: true,
        storyId: true, generationJobId: true, metadata: true, createdAt: true,
      },
    });
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  private group<T extends { estimatedCost: Prisma.Decimal }>(
    rows: T[],
    key: (row: T) => string,
  ) {
    const result: Record<string, number> = {};
    for (const row of rows) result[key(row)] = (result[key(row)] ?? 0) + Number(row.estimatedCost);
    return result;
  }

  private recommendations(
    rows: Array<{
      provider: string;
      requestType: string;
      estimatedCost: Prisma.Decimal;
      generationJobId: string | null;
      metadata: Prisma.JsonValue;
    }>,
  ) {
    if (!rows.length) return [];
    const stages = this.group(rows, (row) => row.requestType);
    const providers = this.group(rows, (row) => row.provider);
    const expensiveStage = Object.entries(stages).sort((a, b) => b[1] - a[1])[0];
    const expensiveProvider = Object.entries(providers).sort((a, b) => b[1] - a[1])[0];
    const retries = rows.filter((row) => {
      const metadata = row.metadata as Record<string, unknown> | null;
      return Number(metadata?.attemptNumber ?? metadata?.retryCount ?? 0) > 1;
    });
    return [
      expensiveStage && { type: 'high_cost_stage', stage: expensiveStage[0], costUsd: expensiveStage[1] },
      expensiveProvider && { type: 'expensive_provider', provider: expensiveProvider[0], costUsd: expensiveProvider[1] },
      retries.length && {
        type: 'retry_cost',
        usageRecords: retries.length,
        costUsd: retries.reduce((sum, row) => sum + Number(row.estimatedCost), 0),
      },
    ].filter(Boolean);
  }
}
