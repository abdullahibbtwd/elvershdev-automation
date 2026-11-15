import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationRunMode,
  ContentPlanStatus,
  ContentScheduleStatus,
  AutomationStage,
  Prisma,
} from '@prisma/client';
import {
  AUTOMATION_NOTIFICATION_TYPES,
  QUEUE_NAMES,
  addMinutes,
  fingerprintIdea,
  formatDateInTimeZone,
  DEFAULT_DAILY_SLOTS,
  generateUniqueContentIdeas,
  isPublishingDayAllowed,
  resolveDailySlot,
  subtractMinutesFromHm,
  zonedDateTimeToUtc,
  type AutomationDailyPlannerPayload,
} from '@ai-video/shared';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationBudgetService } from './automation-budget.service';
import { AutomationConfigService } from './automation-config.service';
import { CreatePlanDto, ListPlansDto } from './dto/list-automation.dto';

@Injectable()
export class ContentPlannerService {
  private readonly logger = new Logger(ContentPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AutomationConfigService,
    private readonly budgetService: AutomationBudgetService,
    private readonly notifications: NotificationsService,
    private readonly queueService: QueueService,
  ) {}

  async listPlans(userId: string, query: ListPlansDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.ContentPlanWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            plannedDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentPlan.findMany({
        where,
        include: {
          schedule: {
            include: {
              scheduledPublications: true,
            },
          },
        },
        orderBy: [{ plannedDate: 'desc' }, { slotIndex: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.contentPlan.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async getPlan(userId: string, id: string) {
    const plan = await this.prisma.contentPlan.findFirst({
      where: { id, userId },
      include: {
        schedule: {
          include: {
            scheduledPublications: true,
            executions: { orderBy: { createdAt: 'desc' }, take: 20 },
          },
        },
      },
    });
    if (!plan) throw new NotFoundException('Content plan not found');
    return plan;
  }

  async createManualPlan(userId: string, dto: CreatePlanDto) {
    await this.configService.getOrCreate(userId);
    const config = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });
    const planDate =
      dto.plannedDate?.slice(0, 10) ?? formatDateInTimeZone(new Date(), config.timezone);
    const existingCount = await this.prisma.contentPlan.count({
      where: { userId, plannedDate: new Date(planDate) },
    });
    const slotIndex = dto.slotIndex ?? existingCount;
    const ideaTitle = dto.ideaTitle?.trim() || `Manual story idea ${planDate} #${slotIndex + 1}`;
    const ideaSummary =
      dto.ideaSummary?.trim() ||
      `Manually created plan for ${config.targetAudience ?? 'general audience'}`;
    const idea = {
      title: ideaTitle,
      summary: ideaSummary,
      category: dto.category ?? config.contentCategories[0] ?? 'Narrative',
      genre: dto.genre ?? config.storyGenres[0] ?? 'Cinematic storytelling',
      theme: dto.theme ?? config.themes[0] ?? 'original',
      topic: dto.topic ?? ideaTitle,
    };
    return this.createPlanAndSchedule({
      userId,
      config,
      planDate,
      slotIndex,
      idea,
      autoApprove: true,
    });
  }

  async approvePlan(userId: string, id: string) {
    const plan = await this.getPlan(userId, id);
    if (plan.status === ContentPlanStatus.CANCELLED) {
      throw new ConflictException('Cancelled plans cannot be approved');
    }
    const updated = await this.prisma.contentPlan.update({
      where: { id: plan.id },
      data: {
        status: ContentPlanStatus.APPROVED,
        approvedAt: new Date(),
      },
      include: { schedule: true },
    });
    if (updated.schedule && updated.schedule.status === ContentScheduleStatus.PLANNED) {
      await this.enqueueOrchestrator(userId, updated.schedule.id);
    }
    return updated;
  }

  async cancelPlan(userId: string, id: string) {
    const plan = await this.getPlan(userId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelledPlan = await tx.contentPlan.update({
        where: { id: plan.id },
        data: {
          status: ContentPlanStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
      if (plan.schedule) {
        await tx.contentSchedule.update({
          where: { id: plan.schedule.id },
          data: {
            status: ContentScheduleStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        });
        await tx.scheduledPublication.updateMany({
          where: {
            contentScheduleId: plan.schedule.id,
            status: { in: ['PENDING', 'SCHEDULED'] },
          },
          data: { status: 'CANCELLED' },
        });
      }
      return cancelledPlan;
    });
    return updated;
  }

  async planDailyForUser(userId: string, options?: { force?: boolean; planDate?: string }) {
    const configRow = await this.prisma.automationConfig.findUnique({ where: { userId } });
    if (!configRow) {
      await this.configService.getOrCreate(userId);
    }
    const config = await this.prisma.automationConfig.findUniqueOrThrow({ where: { userId } });

    if (!options?.force && !this.configService.canScheduleNewWork(config)) {
      return { skipped: true, reason: `Automation not runnable (${config.runMode})` };
    }

    const planDate =
      options?.planDate ?? formatDateInTimeZone(new Date(), config.timezone);
    const planDateObj = new Date(`${planDate}T00:00:00.000Z`);

    if (
      !isPublishingDayAllowed({
        date: zonedDateTimeToUtc(planDate, '12:00', config.timezone),
        timeZone: config.timezone,
        preferredPublishingDays: config.preferredPublishingDays,
        includeWeekends: config.includeWeekends,
      })
    ) {
      return { skipped: true, reason: 'Day not in preferred publishing days' };
    }

    if (!options?.force && config.lastDailyPlanDate === planDate) {
      const existing = await this.prisma.contentPlan.count({
        where: { userId, plannedDate: planDateObj },
      });
      if (existing >= config.dailyGenerationTarget) {
        return { skipped: true, reason: 'Daily plan already created', planDate, existing };
      }
    }

    const monthStart = `${planDate.slice(0, 7)}-01`;
    const monthlyCount = await this.prisma.contentPlan.count({
      where: {
        userId,
        plannedDate: { gte: new Date(monthStart) },
        status: { not: ContentPlanStatus.CANCELLED },
      },
    });
    if (monthlyCount >= config.monthlyGenerationTarget) {
      return { skipped: true, reason: 'Monthly generation target reached', monthlyCount };
    }

    const budget = await this.budgetService.assertBudgetAllows({
      userId,
      timeZone: config.timezone,
      dailyBudgetUsd: config.dailyBudgetUsd,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      maxCostPerVideoUsd: config.maxCostPerVideoUsd,
      estimatedNextCostUsd: 0.5,
    });
    if (!budget.allowed) {
      await this.notifications.notify({
        userId,
        type: AUTOMATION_NOTIFICATION_TYPES.BUDGET_REACHED,
        title: 'Automation budget limit reached',
        body: budget.reason ?? 'Budget limit reached',
        dedupeKey: `budget:${userId}:${planDate}:${budget.reason ?? 'limit'}`,
      });
      return { skipped: true, reason: budget.reason, budget: budget.spend };
    }

    const existingPlans = await this.prisma.contentPlan.findMany({
      where: { userId, plannedDate: planDateObj },
      orderBy: { slotIndex: 'asc' },
    });
    const needed = Math.max(0, config.dailyGenerationTarget - existingPlans.length);
    if (needed === 0) {
      await this.prisma.automationConfig.update({
        where: { userId },
        data: { lastDailyPlanDate: planDate },
      });
      return { skipped: true, reason: 'Target already satisfied', planDate };
    }

    const recent = await this.prisma.contentPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 90,
      select: {
        ideaTitle: true,
        ideaSummary: true,
        ideaFingerprint: true,
      },
    });

    let preferredCategories: string[] = [];
    let deprioritizedCategories: string[] = [];
    if (config.performanceOptimizationEnabled) {
      const optimization = await this.prisma.analyticsOptimizationSettings.findUnique({
        where: { userId },
      });
      if (optimization?.performanceOptimizationEnabled) {
        const summaries = await this.prisma.contentPerformanceSummary.findMany({
          where: {
            userId,
            dimension: 'category',
            sampleSize: { gte: optimization.minSampleSizeForOptimization },
            dimensionValue: { in: config.contentCategories },
          },
          orderBy: [{ avgViews: 'desc' }, { avgEngagementRate: 'desc' }],
        });
        // Only statistically eligible summaries influence weighting. Categories with
        // few weak observations remain in the normal diversity rotation.
        preferredCategories = summaries
          .filter((summary) => ['STRONG', 'TOP'].includes(summary.performanceStatus))
          .map((summary) => summary.dimensionValue);
        deprioritizedCategories = optimization.avoidWeakFormats
          ? summaries
              .filter((summary) => summary.performanceStatus === 'UNDERPERFORMING')
              .map((summary) => summary.dimensionValue)
          : [];
      }
    }

    const ideas = generateUniqueContentIdeas({
      count: needed,
      niche: config.storyGenres[0] ?? 'Motivation',
      audience: config.targetAudience?.trim() || 'General audience',
      categories: config.contentCategories,
      preferredCategories,
      deprioritizedCategories,
      genres: config.storyGenres,
      themes: config.themes,
      tone: config.tone?.trim() || 'Inspirational',
      exclusions: config.contentExclusions,
      daySalt: `${planDate}:${userId.slice(0, 8)}`,
      startingSlotIndex: existingPlans.length,
      dailySlots: DEFAULT_DAILY_SLOTS,
      recent: recent.map((item) => ({
        title: item.ideaTitle,
        summary: item.ideaSummary,
        fingerprint: item.ideaFingerprint,
      })),
    });

    if (ideas.length < needed) {
      this.logger.warn(
        `Only generated ${ideas.length}/${needed} unique ideas for user ${userId} on ${planDate}`,
      );
    }

    const created = [];
    let slotIndex = existingPlans.length;
    for (const idea of ideas) {
      if (monthlyCount + created.length >= config.monthlyGenerationTarget) break;
      const plan = await this.createPlanAndSchedule({
        userId,
        config,
        planDate,
        slotIndex,
        idea,
        autoApprove: true,
      });
      created.push(plan);
      slotIndex += 1;
    }

    await this.prisma.automationConfig.update({
      where: { userId },
      data: { lastDailyPlanDate: planDate },
    });

    await this.notifications.notify({
      userId,
      type: AUTOMATION_NOTIFICATION_TYPES.DAILY_STARTED,
      title: 'Daily automation planning started',
      body: `Created ${created.length} content plan(s) for ${planDate} (target ${config.dailyGenerationTarget}).`,
      dedupeKey: `daily-started:${userId}:${planDate}`,
      metadata: { planDate, count: created.length },
    });

    return { skipped: false, planDate, createdCount: created.length, plans: created };
  }

  async enqueueDailyPlanner(userId: string, payload?: Partial<AutomationDailyPlannerPayload>) {
    const body: AutomationDailyPlannerPayload = {
      userId,
      mode: payload?.mode ?? 'daily',
      planDate: payload?.planDate,
      force: payload?.force,
      useMockAi: payload?.useMockAi,
    };
    const jobId = `auto-plan-${userId}-${body.planDate ?? 'today'}-${body.mode}`;
    const queue = this.queueService.getQueue(QUEUE_NAMES.AUTOMATION_DAILY_PLANNER);
    await queue.add('plan', body, {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return { queued: true, jobId };
  }

  private async createPlanAndSchedule(input: {
    userId: string;
    config: Prisma.AutomationConfigGetPayload<object>;
    planDate: string;
    slotIndex: number;
    idea: {
      title: string;
      summary: string;
      category: string;
      genre: string;
      theme: string;
      topic: string;
      slotKind?: string;
      slotLabel?: string;
    };
    autoApprove: boolean;
  }) {
    const idempotencyKey = `plan:${input.userId}:${input.planDate}:${input.slotIndex}`;
    const existing = await this.prisma.contentPlan.findUnique({
      where: { idempotencyKey },
      include: { schedule: true },
    });
    if (existing) {
      return existing;
    }

    const fingerprint = fingerprintIdea(input.idea);
    const slot = resolveDailySlot(input.slotIndex, DEFAULT_DAILY_SLOTS);
    const publishHm = slot.publishTime;
    const generateHm = subtractMinutesFromHm(publishHm, slot.generateLeadMinutes);
    const publishAt = zonedDateTimeToUtc(
      input.planDate,
      publishHm,
      input.config.timezone,
    );
    let staggeredGeneration = zonedDateTimeToUtc(
      input.planDate,
      generateHm,
      input.config.timezone,
    );
    // If generation would be in the past (manual late plan), start soon.
    if (staggeredGeneration.getTime() < Date.now() - 60_000) {
      staggeredGeneration = addMinutes(new Date(), 1 + input.slotIndex * 2);
    }

    const brief = {
      topic: input.idea.topic,
      niche: input.idea.genre,
      targetAudience:
        input.config.targetAudience?.trim() || 'General audience',
      language: input.config.language?.trim() || 'en',
      tone: slot.toneHint || input.config.tone?.trim() || 'Inspirational',
      desiredDurationSeconds: input.config.targetDurationSeconds,
      category: input.idea.category,
      additionalInstructions: [
        `Daily slot: ${slot.label} (publish ${publishHm} ${input.config.timezone}).`,
        slot.briefInstructions,
        input.config.brandIdentity
          ? `Brand/channel identity: ${input.config.brandIdentity}`
          : null,
        input.config.contentExclusions.length
          ? `Avoid: ${input.config.contentExclusions.join(', ')}`
          : null,
        `Theme: ${input.idea.theme}. Genre: ${input.idea.genre}. Summary: ${input.idea.summary}`,
        'Structure: hook (2–3s) → rising curiosity → emotional/surprising turn → meaningful lesson → soft follow CTA.',
        'Target 6–9 cinematic photoreal scenes. Narration ~45–55s when duration allows.',
        'Hashtags: include 8–15 discovery-friendly tags without # (mix niche + emotional + platform discovery).',
      ]
        .filter(Boolean)
        .join('\n'),
    };

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const plan = await tx.contentPlan.create({
          data: {
            userId: input.userId,
            plannedDate: new Date(input.planDate),
            timezone: input.config.timezone,
            slotIndex: input.slotIndex,
            status: input.autoApprove
              ? ContentPlanStatus.APPROVED
              : ContentPlanStatus.DRAFT,
            category: input.idea.category,
            genre: input.idea.genre,
            theme: input.idea.theme,
            ideaTitle: input.idea.title,
            ideaSummary: input.idea.summary,
            ideaFingerprint: fingerprint,
            storyBrief: brief as Prisma.InputJsonValue,
            approvedAt: input.autoApprove ? new Date() : null,
            idempotencyKey,
            metadata: {
              slotKind: slot.kind,
              slotLabel: slot.label,
              publishTimeLocal: publishHm,
              generateTimeLocal: generateHm,
            } as Prisma.InputJsonValue,
          },
        });

        const schedule = await tx.contentSchedule.create({
          data: {
            userId: input.userId,
            contentPlanId: plan.id,
            status: ContentScheduleStatus.PLANNED,
            currentStage: AutomationStage.PLANNING,
            scheduledGenerationAt: staggeredGeneration,
            scheduledPublishAt: publishAt,
            maxRetries: input.config.maxRetries,
            idempotencyKey: `schedule:${plan.id}`,
          },
        });

        return { ...plan, schedule };
      });

      if (
        input.autoApprove &&
        input.config.runMode === AutomationRunMode.ENABLED &&
        input.config.enabled
      ) {
        await this.enqueueOrchestrator(input.userId, created.schedule.id);
      }

      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.contentPlan.findUnique({
          where: { idempotencyKey },
          include: { schedule: true },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async enqueueOrchestrator(userId: string, contentScheduleId: string) {
    const queue = this.queueService.getQueue(QUEUE_NAMES.AUTOMATION_ORCHESTRATOR);
    await queue.add(
      'advance',
      {
        userId,
        contentScheduleId,
        action: 'advance' as const,
        useMockAi:
          process.env.GEMINI_USE_MOCK === 'true' ||
          process.env.NODE_ENV === 'test' ||
          process.env.SOCIAL_USE_MOCK === 'true',
      },
      {
        jobId: `auto-orch-${contentScheduleId}-advance`,
        delay: 500,
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 5,
        backoff: { type: 'exponential', delay: 8000 },
      },
    );
  }
}
