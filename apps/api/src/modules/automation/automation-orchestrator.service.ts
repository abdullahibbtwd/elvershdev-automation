import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationExecutionStatus,
  AutomationRunMode,
  AutomationStage,
  ContentPlanStatus,
  ContentScheduleStatus,
  JobStatus,
  MotionGenerationStatus,
  NarrationScriptStatus,
  AudioGenerationStatus,
  Prisma,
  StoryStatus,
  VideoRenderStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  AUTOMATION_NOTIFICATION_TYPES,
  QUEUE_NAMES,
  automationStageProgress,
  nextAutomationStage,
  type AutomationOrchestratorPayload,
  type AutomationStageName,
} from '@ai-video/shared';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { MotionService } from '../motion/motion.service';
import { NarrationService } from '../narration/narration.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RenderingService } from '../rendering/rendering.service';
import { StoriesService } from '../stories/stories.service';
import { VisualsService } from '../visuals/visuals.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { AutomationBudgetService } from './automation-budget.service';
import { AutomationConfigService } from './automation-config.service';
import { AutomationPublishSchedulerService } from './automation-publish-scheduler.service';
import { ListExecutionsDto } from './dto/list-automation.dto';

const ACTIVE_SCHEDULE_STATUSES: ContentScheduleStatus[] = [
  ContentScheduleStatus.QUEUED,
  ContentScheduleStatus.GENERATING,
  ContentScheduleStatus.RENDERING,
  ContentScheduleStatus.SCHEDULING_PUBLISH,
  ContentScheduleStatus.PUBLISHING,
];

const TERMINAL_SCHEDULE_STATUSES: ContentScheduleStatus[] = [
  ContentScheduleStatus.COMPLETED,
  ContentScheduleStatus.CANCELLED,
  ContentScheduleStatus.SKIPPED,
];

/** Mock AI still uses real queues; poll faster so E2E tests finish in seconds not minutes. */
function stagePollDelayMs(normalMs: number, useMockAi = false): number {
  if (!useMockAi) return normalMs;
  return Math.min(normalMs, 400);
}

function isMockAiEnabled(explicit?: boolean): boolean {
  if (explicit === true) return true;
  return (
    process.env.GEMINI_USE_MOCK === 'true' ||
    process.env.FAL_USE_MOCK === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}

@Injectable()
export class AutomationOrchestratorService {
  private readonly logger = new Logger(AutomationOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AutomationConfigService,
    private readonly budgetService: AutomationBudgetService,
    private readonly storiesService: StoriesService,
    private readonly visualsService: VisualsService,
    private readonly motionService: MotionService,
    private readonly narrationService: NarrationService,
    private readonly renderingService: RenderingService,
    private readonly publishScheduler: AutomationPublishSchedulerService,
    private readonly notifications: NotificationsService,
    private readonly queueService: QueueService,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async listExecutions(userId: string, query: ListExecutionsDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.AutomationExecutionWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contentScheduleId ? { contentScheduleId: query.contentScheduleId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.automationExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.automationExecution.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async getExecution(userId: string, id: string) {
    const execution = await this.prisma.automationExecution.findFirst({
      where: { id, userId },
      include: { contentSchedule: { include: { contentPlan: true } } },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  async retryExecution(userId: string, id: string) {
    const execution = await this.getExecution(userId, id);
    if (!execution.contentScheduleId) {
      throw new BadRequestException('Execution is not linked to a schedule');
    }
    await this.prisma.contentSchedule.update({
      where: { id: execution.contentScheduleId },
      data: {
        status: ContentScheduleStatus.QUEUED,
        lastError: null,
        retryCount: { increment: 1 },
      },
    });
    await this.enqueueAdvance(userId, execution.contentScheduleId, 'retry');
    return { queued: true, contentScheduleId: execution.contentScheduleId };
  }

  async advanceSchedule(payload: AutomationOrchestratorPayload) {
    const schedule = await this.prisma.contentSchedule.findFirst({
      where: { id: payload.contentScheduleId, userId: payload.userId },
      include: { contentPlan: true },
    });
    if (!schedule) {
      throw new NotFoundException('Content schedule not found');
    }
    if (TERMINAL_SCHEDULE_STATUSES.includes(schedule.status) && !payload.force) {
      return { skipped: true, reason: `Schedule is ${schedule.status}` };
    }
    if (
      (schedule.status === ContentScheduleStatus.PAUSED ||
        schedule.status === ContentScheduleStatus.CANCELLED) &&
      !payload.force
    ) {
      return { skipped: true, reason: `Schedule is ${schedule.status}` };
    }

    const config = await this.prisma.automationConfig.findUnique({
      where: { userId: payload.userId },
    });
    if (!config) {
      throw new BadRequestException('Automation config missing');
    }

    if (
      config.runMode === AutomationRunMode.EMERGENCY_STOP &&
      payload.action !== 'cancel' &&
      !payload.force
    ) {
      return { skipped: true, reason: 'Emergency stop active' };
    }

    if (
      config.runMode === AutomationRunMode.PAUSED &&
      !ACTIVE_SCHEDULE_STATUSES.includes(schedule.status) &&
      schedule.status !== ContentScheduleStatus.PLANNED &&
      !payload.force
    ) {
      return { skipped: true, reason: 'Automation paused' };
    }

    // Do not start brand-new generation while paused/stopped
    if (
      schedule.currentStage === AutomationStage.PLANNING &&
      !this.configService.canScheduleNewWork(config) &&
      !payload.force
    ) {
      await this.prisma.contentSchedule.update({
        where: { id: schedule.id },
        data: { status: ContentScheduleStatus.PAUSED, pausedAt: new Date() },
      });
      return { skipped: true, reason: 'Cannot start new work while paused/stopped' };
    }

    if (
      schedule.scheduledGenerationAt &&
      schedule.scheduledGenerationAt.getTime() > Date.now() &&
      schedule.currentStage === AutomationStage.PLANNING &&
      !payload.force
    ) {
      const delay = schedule.scheduledGenerationAt.getTime() - Date.now();
      await this.enqueueAdvance(payload.userId, schedule.id, 'advance', delay);
      return { deferred: true, delayMs: delay };
    }

    const budget = await this.budgetService.assertBudgetAllows({
      userId: payload.userId,
      timeZone: config.timezone,
      dailyBudgetUsd: config.dailyBudgetUsd,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      maxCostPerVideoUsd: config.maxCostPerVideoUsd,
      estimatedNextCostUsd: 0.25,
    });
    if (!budget.allowed) {
      await this.prisma.contentSchedule.update({
        where: { id: schedule.id },
        data: {
          status: ContentScheduleStatus.BUDGET_BLOCKED,
          lastError: budget.reason,
        },
      });
      await this.notifications.notify({
        userId: payload.userId,
        type: AUTOMATION_NOTIFICATION_TYPES.BUDGET_REACHED,
        title: 'Schedule blocked by budget',
        body: budget.reason ?? 'Budget limit reached',
        dedupeKey: `budget-block:${schedule.id}`,
      });
      return { blocked: true, reason: budget.reason };
    }

    const concurrent = await this.prisma.contentSchedule.count({
      where: {
        userId: payload.userId,
        status: { in: ACTIVE_SCHEDULE_STATUSES },
        id: { not: schedule.id },
      },
    });
    if (concurrent >= config.maxConcurrentGeneration && schedule.currentStage === AutomationStage.PLANNING) {
      await this.enqueueAdvance(payload.userId, schedule.id, 'advance', 15_000);
      return { deferred: true, reason: 'Max concurrent generation reached' };
    }

    try {
      return await this.runStage(schedule, config, payload.useMockAi === true);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Orchestrator failed for ${schedule.id}: ${message}`);
      const retryCount = schedule.retryCount + 1;
      const failed =
        retryCount >= schedule.maxRetries
          ? ContentScheduleStatus.FAILED
          : schedule.status === ContentScheduleStatus.PLANNED
            ? ContentScheduleStatus.QUEUED
            : schedule.status;

      await this.prisma.contentSchedule.update({
        where: { id: schedule.id },
        data: {
          status: failed,
          lastError: message,
          retryCount,
        },
      });

      this.realtime.emitAutomationProgress(payload.userId, {
        scheduleId: schedule.id,
        stage: schedule.currentStage,
        status: failed,
        progress: automationStageProgress(schedule.currentStage as AutomationStageName),
        message:
          retryCount < schedule.maxRetries
            ? `Stage failed — retry ${retryCount}/${schedule.maxRetries}`
            : 'Pipeline failed',
        error: message,
      });

      if (retryCount < schedule.maxRetries) {
        const delay = Math.min(300_000, 5000 * 2 ** retryCount);
        await this.enqueueAdvance(payload.userId, schedule.id, 'retry', delay);
      }

      return { failed: true, error: message, retryCount };
    }
  }

  async cancelSchedule(userId: string, scheduleId: string) {
    const schedule = await this.prisma.contentSchedule.findFirst({
      where: { id: scheduleId, userId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    if (TERMINAL_SCHEDULE_STATUSES.includes(schedule.status)) {
      throw new ConflictException(`Cannot cancel schedule in status ${schedule.status}`);
    }
    return this.prisma.contentSchedule.update({
      where: { id: scheduleId },
      data: {
        status: ContentScheduleStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  async pauseSchedule(userId: string, scheduleId: string) {
    const schedule = await this.prisma.contentSchedule.findFirst({
      where: { id: scheduleId, userId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return this.prisma.contentSchedule.update({
      where: { id: scheduleId },
      data: {
        status: ContentScheduleStatus.PAUSED,
        pausedAt: new Date(),
      },
    });
  }

  async triggerSchedule(userId: string, scheduleId: string, options?: { publishNow?: boolean }) {
    const schedule = await this.prisma.contentSchedule.findFirst({
      where: { id: scheduleId, userId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    if (schedule.status === ContentScheduleStatus.CANCELLED) {
      throw new ConflictException('Cancelled schedule cannot be triggered');
    }
    const now = new Date();
    await this.prisma.contentSchedule.update({
      where: { id: scheduleId },
      data: {
        status: ContentScheduleStatus.QUEUED,
        pausedAt: null,
        scheduledGenerationAt: now,
        ...(options?.publishNow ? { scheduledPublishAt: now } : {}),
      },
    });
    await this.enqueueAdvance(userId, scheduleId, 'start');
    this.realtime.emitAutomationProgress(userId, {
      scheduleId,
      stage: schedule.currentStage,
      status: ContentScheduleStatus.QUEUED,
      progress: automationStageProgress(schedule.currentStage as AutomationStageName),
      message: options?.publishNow
        ? 'Queued for pipeline (publish immediately when ready)'
        : 'Queued for pipeline',
    });
    return { queued: true };
  }

  /** Fail fast before spending queue cycles when real providers are enabled without keys. */
  assertRealProvidersConfigured() {
    const missing: string[] = [];
    const mockGemini = process.env.GEMINI_USE_MOCK === 'true';
    const mockFal = process.env.FAL_USE_MOCK === 'true';
    const mockHailuo = process.env.HAILUO_USE_MOCK === 'true';
    const mockTts = process.env.GEMINI_TTS_USE_MOCK === 'true';
    const klingEnabled = process.env.KLING_ENABLED === 'true';
    const hailuoEnabled = process.env.HAILUO_ENABLED !== 'false';

    if (!mockGemini && !process.env.GEMINI_API_KEY?.trim()) missing.push('GEMINI_API_KEY');
    if (!mockTts && !process.env.GEMINI_API_KEY?.trim()) missing.push('GEMINI_API_KEY (TTS)');
    // Images (Fal) + default motion (Hailuo via Fal) share FAL_API_KEY.
    if ((!mockFal || (hailuoEnabled && !mockHailuo)) && !process.env.FAL_API_KEY?.trim()) {
      missing.push('FAL_API_KEY');
    }
    // Kling is optional / disabled by default — only require keys when explicitly enabled.
    if (klingEnabled && process.env.KLING_USE_MOCK !== 'true') {
      const hasKling =
        Boolean(process.env.KLING_API_KEY?.trim()) ||
        (Boolean(process.env.KLING_ACCESS_KEY?.trim()) &&
          Boolean(process.env.KLING_SECRET_KEY?.trim()));
      if (!hasKling) missing.push('KLING_API_KEY or KLING_ACCESS_KEY+KLING_SECRET_KEY');
    }

    if (missing.length) {
      throw new BadRequestException(
        `Real AI mode is on but missing: ${[...new Set(missing)].join(', ')}. Add them to .env and restart API + worker.`,
      );
    }

    return {
      geminiMock: mockGemini,
      falMock: mockFal,
      hailuoMock: mockHailuo,
      klingEnabled,
      hailuoEnabled,
      ttsMock: mockTts,
      socialMock: process.env.SOCIAL_USE_MOCK === 'true',
      motionProvider: process.env.VIDEO_GENERATION_PROVIDER || 'hailuo',
    };
  }

  async recoverStalled(userId?: string) {
    const stalledBefore = new Date(Date.now() - 15 * 60_000);
    const stalled = await this.prisma.contentSchedule.findMany({
      where: {
        ...(userId ? { userId } : {}),
        status: { in: ACTIVE_SCHEDULE_STATUSES },
        stageStartedAt: { lt: stalledBefore },
      },
      take: 50,
    });
    for (const item of stalled) {
      await this.prisma.automationExecution.create({
        data: {
          userId: item.userId,
          contentScheduleId: item.id,
          stage: item.currentStage,
          status: AutomationExecutionStatus.STALLED,
          idempotencyKey: `stalled:${item.id}:${item.currentStage}:${item.stageStartedAt?.toISOString() ?? 'x'}`,
          lastError: 'Stage appeared stalled; re-queued for recovery',
        },
      }).catch(() => undefined);
      await this.enqueueAdvance(item.userId, item.id, 'recover');
    }
    return { recovered: stalled.length };
  }

  async enqueueAdvance(
    userId: string,
    contentScheduleId: string,
    action: AutomationOrchestratorPayload['action'] = 'advance',
    delayMs = 0,
  ) {
    const queue = this.queueService.getQueue(QUEUE_NAMES.AUTOMATION_ORCHESTRATOR);
    const jobId = `auto-orch-${contentScheduleId}-${action}-${Date.now()}`;
    await queue.add(
      action,
      {
        userId,
        contentScheduleId,
        action,
        useMockAi:
          process.env.GEMINI_USE_MOCK === 'true' ||
          process.env.NODE_ENV === 'test' ||
          process.env.FAL_USE_MOCK === 'true',
      } satisfies AutomationOrchestratorPayload,
      {
        jobId,
        delay: Math.max(0, delayMs),
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  private async runStage(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    config: Prisma.AutomationConfigGetPayload<object>,
    useMockAi: boolean,
  ) {
    const stage = schedule.currentStage;

    if (stage === AutomationStage.PLANNING || stage === AutomationStage.STORY_GENERATION) {
      return this.ensureStory(schedule, config, useMockAi);
    }
    if (stage === AutomationStage.SCENE_PLANNING) {
      return this.ensureScenes(schedule, useMockAi);
    }
    if (stage === AutomationStage.VISUAL_INTELLIGENCE) {
      return this.ensureVisuals(schedule, config, useMockAi);
    }
    if (stage === AutomationStage.MOTION_GENERATION) {
      return this.ensureMotion(schedule, useMockAi);
    }
    if (stage === AutomationStage.NARRATION) {
      return this.ensureNarration(schedule, useMockAi);
    }
    if (stage === AutomationStage.SPEECH) {
      return this.ensureSpeech(schedule, config, useMockAi);
    }
    if (stage === AutomationStage.RENDER) {
      return this.ensureRender(schedule, useMockAi);
    }
    if (stage === AutomationStage.PUBLISH_SCHEDULE) {
      return this.ensurePublishSchedule(schedule, config);
    }
    if (stage === AutomationStage.DONE) {
      await this.prisma.contentSchedule.update({
        where: { id: schedule.id },
        data: {
          status: ContentScheduleStatus.COMPLETED,
          progress: 100,
          completedAt: new Date(),
        },
      });
      return { completed: true };
    }

    return { skipped: true, reason: `Unknown stage ${stage}` };
  }

  private async ensureStory(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    config: Prisma.AutomationConfigGetPayload<object>,
    useMockAi: boolean,
  ) {
    if (schedule.storyId) {
      const story = await this.prisma.story.findUnique({ where: { id: schedule.storyId } });
      if (story?.status === StoryStatus.READY && story.content) {
        return this.completeStage(schedule, AutomationStage.SCENE_PLANNING);
      }
      if (story?.status === StoryStatus.GENERATING) {
        await this.enqueueAdvance(
          schedule.userId,
          schedule.id,
          'advance',
          stagePollDelayMs(5000, useMockAi),
        );
        return { waiting: true, stage: 'STORY_GENERATION' };
      }
      if (story?.status === StoryStatus.FAILED) {
        throw new Error(story.title ? `Story generation failed for ${story.id}` : 'Story failed');
      }
    }

    await this.beginStage(schedule, AutomationStage.STORY_GENERATION, ContentScheduleStatus.GENERATING);
    const brief = schedule.contentPlan.storyBrief as {
      topic: string;
      niche: string;
      targetAudience: string;
      language?: string;
      tone: string;
      desiredDurationSeconds: number;
      category: string;
      additionalInstructions?: string;
    };

    const result = await this.storiesService.generate(schedule.userId, {
      topic: brief.topic?.trim() || schedule.contentPlan.ideaTitle || 'Untitled story',
      niche: brief.niche?.trim() || config.storyGenres[0] || 'Cinematic storytelling',
      targetAudience:
        brief.targetAudience?.trim() ||
        config.targetAudience?.trim() ||
        'General audience',
      language: brief.language?.trim() || config.language?.trim() || 'en',
      tone: brief.tone?.trim() || config.tone?.trim() || 'Inspirational',
      desiredDurationSeconds:
        brief.desiredDurationSeconds || config.targetDurationSeconds || 60,
      category:
        brief.category?.trim() ||
        schedule.contentPlan.category ||
        config.contentCategories[0] ||
        'Narrative',
      additionalInstructions: brief.additionalInstructions,
      ...(useMockAi ? {} : {}),
    });

    await this.prisma.$transaction([
      this.prisma.contentSchedule.update({
        where: { id: schedule.id },
        data: { storyId: result.story.id },
      }),
      this.prisma.contentPlan.update({
        where: { id: schedule.contentPlanId },
        data: {
          storyId: result.story.id,
          status: ContentPlanStatus.GENERATING,
        },
      }),
    ]);

    await this.recordExecution(schedule, AutomationStage.STORY_GENERATION, result.job.id);
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(4000, useMockAi),
    );
    return { started: true, storyId: result.story.id };
  }

  private async ensureScenes(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    useMockAi = false,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');
    const story = await this.prisma.story.findUnique({
      where: { id: schedule.storyId },
      include: { scenes: { select: { id: true } } },
    });
    if (!story) throw new Error('Story missing');

    if (story.scenes.length > 0 && story.status === StoryStatus.READY) {
      return this.completeStage(schedule, AutomationStage.VISUAL_INTELLIGENCE);
    }

    const active = await this.prisma.generationJob.findFirst({
      where: {
        storyId: story.id,
        jobType: { in: ['STORY', 'SCENE_PLANNING'] },
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active || story.status === StoryStatus.GENERATING) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(4000, useMockAi),
      );
      return { waiting: true, stage: 'SCENE_PLANNING' };
    }

    if (story.scenes.length === 0 && story.content) {
      await this.beginStage(schedule, AutomationStage.SCENE_PLANNING, ContentScheduleStatus.GENERATING);
      const result = await this.storiesService.planScenes(schedule.userId, story.id);
      await this.recordExecution(schedule, AutomationStage.SCENE_PLANNING, result.job.id);
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(4000, useMockAi),
      );
      return { started: true, scenePlanning: true };
    }

    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(4000, useMockAi),
    );
    return { waiting: true };
  }

  private async ensureVisuals(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    config: Prisma.AutomationConfigGetPayload<object>,
    useMockAi: boolean,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId: schedule.storyId },
      include: {
        visuals: {
          where: { generationStatus: VisualGenerationStatus.COMPLETED, generatedImageMediaId: { not: null } },
        },
      },
    });
    if (scenes.length === 0) throw new Error('No scenes available for visuals');

    const allReady = scenes.every((scene) => scene.visuals.length > 0);
    if (allReady) {
      return this.completeStage(schedule, AutomationStage.MOTION_GENERATION);
    }

    const active = await this.prisma.generationJob.findFirst({
      where: {
        storyId: schedule.storyId,
        jobType: { in: ['VISUAL_ANALYSIS', 'CHARACTER_REFERENCE', 'IMAGE'] },
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(6000, useMockAi),
      );
      return { waiting: true, stage: 'VISUAL_INTELLIGENCE' };
    }

    await this.beginStage(schedule, AutomationStage.VISUAL_INTELLIGENCE, ContentScheduleStatus.GENERATING);
    const result = await this.visualsService.generateForStory(schedule.userId, schedule.storyId, {
      ...(config.visualStyleId ? { visualStyleId: config.visualStyleId } : {}),
    });
    await this.recordExecution(schedule, AutomationStage.VISUAL_INTELLIGENCE, result.job?.id);
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(6000, useMockAi),
    );
    return { started: true, useMockAi };
  }

  private async ensureMotion(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    useMockAi: boolean,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId: schedule.storyId },
      include: {
        motionGenerations: {
          where: {
            status: MotionGenerationStatus.COMPLETED,
            outputMediaAssetId: { not: null },
          },
        },
      },
    });
    const allReady = scenes.every((scene) => scene.motionGenerations.length > 0);
    if (allReady) {
      return this.completeStage(schedule, AutomationStage.NARRATION);
    }

    const active = await this.prisma.motionGeneration.findFirst({
      where: {
        storyId: schedule.storyId,
        status: {
          in: [
            MotionGenerationStatus.PENDING,
            MotionGenerationStatus.ANALYZING,
            MotionGenerationStatus.SUBMITTING,
            MotionGenerationStatus.PROCESSING,
            MotionGenerationStatus.DOWNLOADING,
            MotionGenerationStatus.VALIDATING,
          ],
        },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(8000, useMockAi),
      );
      return { waiting: true, stage: 'MOTION_GENERATION' };
    }

    await this.beginStage(schedule, AutomationStage.MOTION_GENERATION, ContentScheduleStatus.GENERATING);
    await this.motionService.generateForStory(schedule.userId, schedule.storyId, {});
    await this.recordExecution(schedule, AutomationStage.MOTION_GENERATION);
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(8000, useMockAi),
    );
    return { started: true, useMockAi };
  }

  private async ensureNarration(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    useMockAi: boolean,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');
    const script = await this.prisma.narrationScript.findFirst({
      where: {
        storyId: schedule.storyId,
        status: { in: [NarrationScriptStatus.READY, NarrationScriptStatus.APPROVED] },
      },
      orderBy: { version: 'desc' },
    });
    if (script) {
      return this.completeStage(schedule, AutomationStage.SPEECH);
    }

    const active = await this.prisma.generationJob.findFirst({
      where: {
        storyId: schedule.storyId,
        jobType: 'NARRATION_PLANNING',
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(5000, useMockAi),
      );
      return { waiting: true, stage: 'NARRATION' };
    }

    await this.beginStage(schedule, AutomationStage.NARRATION, ContentScheduleStatus.GENERATING);
    const result = await this.narrationService.planNarration(schedule.userId, schedule.storyId, {
      useMockAi,
    });
    await this.recordExecution(
      schedule,
      AutomationStage.NARRATION,
      (result as { job?: { id?: string } })?.job?.id,
    );
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(5000, useMockAi),
    );
    return { started: true };
  }

  private async ensureSpeech(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    config: Prisma.AutomationConfigGetPayload<object>,
    useMockAi: boolean,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');
    const scenes = await this.prisma.storyScene.findMany({
      where: { storyId: schedule.storyId },
      include: {
        audioGenerations: {
          where: {
            status: AudioGenerationStatus.COMPLETED,
            audioMediaAssetId: { not: null },
            isSelected: true,
          },
        },
      },
    });
    const ready =
      scenes.length > 0 &&
      scenes.every((scene) => scene.audioGenerations.length > 0);
    if (ready) {
      await this.ensureNarrationApprovedForAutomation(schedule.userId, schedule.storyId);
      return this.completeStage(schedule, AutomationStage.RENDER);
    }

    const active = await this.prisma.audioGeneration.findFirst({
      where: {
        storyId: schedule.storyId,
        status: {
          in: [
            AudioGenerationStatus.PENDING,
            AudioGenerationStatus.GENERATING,
            AudioGenerationStatus.VALIDATING,
            AudioGenerationStatus.STORING,
          ],
        },
      },
    });
    if (active) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(6000, useMockAi),
      );
      return { waiting: true, stage: 'SPEECH' };
    }

    await this.beginStage(schedule, AutomationStage.SPEECH, ContentScheduleStatus.GENERATING);
    await this.narrationService.generateStoryAudio(schedule.userId, schedule.storyId, {
      useMockAi,
      ...(config.narrationVoiceId ? { voiceProfileId: config.narrationVoiceId } : {}),
    });
    await this.recordExecution(schedule, AutomationStage.SPEECH);
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(6000, useMockAi),
    );
    return { started: true };
  }

  /**
   * Unattended automation has no human approval step. Promote READY narration to
   * APPROVED so render readiness (which requires APPROVED) can proceed.
   */
  private async ensureNarrationApprovedForAutomation(userId: string, storyId: string) {
    const script = await this.prisma.narrationScript.findFirst({
      where: {
        userId,
        storyId,
        status: { in: [NarrationScriptStatus.READY, NarrationScriptStatus.APPROVED] },
      },
      orderBy: { version: 'desc' },
    });
    if (!script) {
      throw new Error('Narration script is not ready for automated render approval');
    }
    if (script.status === NarrationScriptStatus.APPROVED) {
      return script;
    }
    this.logger.log(`Auto-approving narration script ${script.id} for automation story ${storyId}`);
    return this.narrationService.approveScript(userId, script.id);
  }

  private async ensureRender(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    useMockAi: boolean,
  ) {
    if (!schedule.storyId) throw new Error('Missing storyId');

    if (schedule.videoRenderId) {
      const render = await this.prisma.videoRender.findUnique({
        where: { id: schedule.videoRenderId },
      });
      if (render?.status === VideoRenderStatus.COMPLETED && render.outputMediaAssetId) {
        await this.notifications.notify({
          userId: schedule.userId,
          type: AUTOMATION_NOTIFICATION_TYPES.RENDER_COMPLETED,
          title: 'Automated video render completed',
          body: `Render ${render.id} is ready for scheduling.`,
          dedupeKey: `render-done:${render.id}`,
        });
        return this.completeStage(schedule, AutomationStage.PUBLISH_SCHEDULE);
      }
      if (render) {
        const terminal: VideoRenderStatus[] = [
          VideoRenderStatus.FAILED,
          VideoRenderStatus.CANCELLED,
          VideoRenderStatus.COMPLETED,
        ];
        if (!terminal.includes(render.status)) {
          await this.enqueueAdvance(
            schedule.userId,
            schedule.id,
            'advance',
            stagePollDelayMs(8000, useMockAi),
          );
          return { waiting: true, stage: 'RENDER' };
        }
        if (render.status === VideoRenderStatus.FAILED) {
          throw new Error(render.errorMessage ?? 'Render failed');
        }
      }
    }

    await this.ensureNarrationApprovedForAutomation(schedule.userId, schedule.storyId);

    const readiness = await this.renderingService.getReadiness(schedule.userId, schedule.storyId);
    if (!readiness.canRender) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(8000, useMockAi),
      );
      return { waiting: true, reason: 'Render readiness not met', missing: readiness.missing };
    }

    await this.beginStage(schedule, AutomationStage.RENDER, ContentScheduleStatus.RENDERING);
    const render = await this.renderingService.createRender(schedule.userId, schedule.storyId, {});
    const renderId = render.id;
    await this.prisma.contentSchedule.update({
      where: { id: schedule.id },
      data: { videoRenderId: renderId },
    });
    await this.recordExecution(
      schedule,
      AutomationStage.RENDER,
      render.generationJob?.id ?? undefined,
    );
    await this.enqueueAdvance(
      schedule.userId,
      schedule.id,
      'advance',
      stagePollDelayMs(8000, useMockAi),
    );
    return { started: true, videoRenderId: renderId, useMockAi };
  }

  private async ensurePublishSchedule(
    schedule: Prisma.ContentScheduleGetPayload<{ include: { contentPlan: true } }>,
    config: Prisma.AutomationConfigGetPayload<object>,
  ) {
    if (!schedule.videoRenderId) throw new Error('Missing videoRenderId');
    const render = await this.prisma.videoRender.findFirst({
      where: {
        id: schedule.videoRenderId,
        userId: schedule.userId,
        status: VideoRenderStatus.COMPLETED,
        outputMediaAssetId: { not: null },
      },
    });
    if (!render) {
      throw new Error('Render is not completed/validated; refusing to schedule publish');
    }

    await this.beginStage(
      schedule,
      AutomationStage.PUBLISH_SCHEDULE,
      ContentScheduleStatus.SCHEDULING_PUBLISH,
    );

    const result = await this.publishScheduler.scheduleForRender({
      userId: schedule.userId,
      contentScheduleId: schedule.id,
      videoRenderId: render.id,
      config,
      storyId: schedule.storyId,
      scheduledPublishAt: schedule.scheduledPublishAt,
    });

    await this.notifications.notify({
      userId: schedule.userId,
      type: AUTOMATION_NOTIFICATION_TYPES.VIDEO_SCHEDULED,
      title: 'Video scheduled for publishing',
      body: `Scheduled ${result.created} channel publication(s); ${result.skipped} skipped.`,
      dedupeKey: `video-scheduled:${schedule.id}`,
    });

    await this.prisma.contentPlan.update({
      where: { id: schedule.contentPlanId },
      data: { status: ContentPlanStatus.GENERATED },
    });

    return this.completeStage(schedule, AutomationStage.DONE);
  }

  private async beginStage(
    schedule: { id: string; userId: string; startedAt?: Date | null },
    stage: AutomationStage,
    status: ContentScheduleStatus,
  ) {
    const progress = automationStageProgress(stage as AutomationStageName);
    await this.prisma.contentSchedule.update({
      where: { id: schedule.id },
      data: {
        currentStage: stage,
        status,
        progress,
        stageStartedAt: new Date(),
        ...(!schedule.startedAt ? { startedAt: new Date() } : {}),
      },
    });
    this.realtime.emitAutomationProgress(schedule.userId, {
      scheduleId: schedule.id,
      stage,
      status,
      progress,
      message: `Started ${stage}`,
    });
  }

  private async completeStage(
    schedule: { id: string; userId: string; startedAt: Date | null },
    next: AutomationStage,
  ) {
    const progress =
      next === AutomationStage.DONE
        ? 100
        : automationStageProgress(next as AutomationStageName);
    const status =
      next === AutomationStage.DONE
        ? ContentScheduleStatus.COMPLETED
        : next === AutomationStage.PUBLISH_SCHEDULE
          ? ContentScheduleStatus.SCHEDULING_PUBLISH
          : ContentScheduleStatus.GENERATING;

    await this.prisma.contentSchedule.update({
      where: { id: schedule.id },
      data: {
        currentStage: next,
        progress,
        stageStartedAt: new Date(),
        ...(next === AutomationStage.DONE
          ? {
              status: ContentScheduleStatus.COMPLETED,
              completedAt: new Date(),
              progress: 100,
            }
          : {}),
        ...(next === AutomationStage.PUBLISH_SCHEDULE
          ? { status: ContentScheduleStatus.SCHEDULING_PUBLISH }
          : {}),
        ...(!schedule.startedAt ? { startedAt: new Date() } : {}),
      },
    });

    this.realtime.emitAutomationProgress(schedule.userId, {
      scheduleId: schedule.id,
      stage: next,
      status,
      progress,
      message:
        next === AutomationStage.DONE
          ? 'Pipeline complete'
          : `Advanced to ${next}`,
    });

    if (next !== AutomationStage.DONE) {
      await this.enqueueAdvance(
        schedule.userId,
        schedule.id,
        'advance',
        stagePollDelayMs(1000, isMockAiEnabled()),
      );
    }
    return { advancedTo: next, nextHint: nextAutomationStage(next as AutomationStageName) };
  }

  private async recordExecution(
    schedule: { id: string; userId: string; contentPlanId: string },
    stage: AutomationStage,
    generationJobId?: string,
  ) {
    const attempt = await this.prisma.automationExecution.count({
      where: { contentScheduleId: schedule.id, stage },
    });
    await this.prisma.automationExecution.create({
      data: {
        userId: schedule.userId,
        contentScheduleId: schedule.id,
        contentPlanId: schedule.contentPlanId,
        stage,
        status: AutomationExecutionStatus.RUNNING,
        generationJobId: generationJobId ?? null,
        attemptNumber: attempt + 1,
        startedAt: new Date(),
        idempotencyKey: `exec:${schedule.id}:${stage}:${attempt + 1}`,
      },
    }).catch(() => undefined);
  }
}
