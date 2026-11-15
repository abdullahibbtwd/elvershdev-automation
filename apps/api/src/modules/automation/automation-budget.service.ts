import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateInTimeZone, getZonedParts } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AutomationBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async getSpend(userId: string, timeZone: string) {
    const now = new Date();
    const today = formatDateInTimeZone(now, timeZone);
    const parts = getZonedParts(now, timeZone);
    const monthPrefix = `${parts.year}-${String(parts.month).padStart(2, '0')}`;

    const usages = await this.prisma.providerUsage.findMany({
      where: { userId },
      select: { estimatedCost: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    let daily = new Prisma.Decimal(0);
    let monthly = new Prisma.Decimal(0);
    for (const usage of usages) {
      const localDate = formatDateInTimeZone(usage.createdAt, timeZone);
      const cost = usage.estimatedCost ?? new Prisma.Decimal(0);
      if (localDate.startsWith(monthPrefix)) {
        monthly = monthly.add(cost);
      }
      if (localDate === today) {
        daily = daily.add(cost);
      }
    }

    return {
      dailyUsd: Number(daily),
      monthlyUsd: Number(monthly),
      asOf: now.toISOString(),
      timezone: timeZone,
      note: 'Estimated from ProviderUsage.estimatedCost using configured provider prices.',
    };
  }

  async assertBudgetAllows(input: {
    userId: string;
    timeZone: string;
    dailyBudgetUsd?: Prisma.Decimal | number | null;
    monthlyBudgetUsd?: Prisma.Decimal | number | null;
    maxCostPerVideoUsd?: Prisma.Decimal | number | null;
    estimatedNextCostUsd?: number;
  }): Promise<{ allowed: boolean; reason?: string; spend: Awaited<ReturnType<AutomationBudgetService['getSpend']>> }> {
    const spend = await this.getSpend(input.userId, input.timeZone);
    const nextCost = input.estimatedNextCostUsd ?? 0;

    if (input.dailyBudgetUsd != null) {
      const limit = Number(input.dailyBudgetUsd);
      if (spend.dailyUsd + nextCost > limit) {
        return {
          allowed: false,
          reason: `Daily budget limit reached (spent ~$${spend.dailyUsd.toFixed(2)} / $${limit.toFixed(2)})`,
          spend,
        };
      }
    }

    if (input.monthlyBudgetUsd != null) {
      const limit = Number(input.monthlyBudgetUsd);
      if (spend.monthlyUsd + nextCost > limit) {
        return {
          allowed: false,
          reason: `Monthly budget limit reached (spent ~$${spend.monthlyUsd.toFixed(2)} / $${limit.toFixed(2)})`,
          spend,
        };
      }
    }

    if (input.maxCostPerVideoUsd != null && nextCost > Number(input.maxCostPerVideoUsd)) {
      return {
        allowed: false,
        reason: `Estimated cost per video ($${nextCost.toFixed(2)}) exceeds maxCostPerVideoUsd`,
        spend,
      };
    }

    return { allowed: true, spend };
  }
}
