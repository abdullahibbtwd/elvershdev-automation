import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AutomationRunMode } from '@prisma/client';
import { QUEUE_NAMES } from '@ai-video/shared';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { AutomationOrchestratorService } from './automation-orchestrator.service';
import { ContentPlannerService } from './content-planner.service';

/**
 * Scheduler tick is enqueue-only. Side effects run in AutomationQueueHost workers
 * so HTTP API replicas never duplicate work and restarts do not drop due work.
 */
@Injectable()
export class AutomationCronService {
  private readonly logger = new Logger(AutomationCronService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly planner: ContentPlannerService,
    private readonly orchestrator: AutomationOrchestratorService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!shouldRunSchedulers()) return;
    if (process.env.AUTOMATION_CRON_DISABLED === 'true') return;
    if (this.ticking) return;
    this.ticking = true;
    try {
      const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 55);
      const { acquired } = await this.locks.withLock('cron:automation', ttl, () =>
        this.runTick(),
      );
      if (!acquired) {
        this.logger.debug('Automation cron lock not acquired — skipping duplicate tick');
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runTick() {
    try {
      const emergency = await this.prisma.setting.findUnique({
        where: { key: 'system:automation:emergencyStop' },
      });
      const emergencyActive =
        emergency &&
        typeof emergency.value === 'object' &&
        emergency.value !== null &&
        (emergency.value as { active?: boolean }).active === true;
      if (emergencyActive) {
        this.logger.debug('Global emergency stop active — skipping planner enqueue');
        await this.orchestrator.recoverStalled();
        return;
      }

      const globalPause = await this.prisma.setting.findUnique({
        where: { key: 'system:automation:globalPause' },
      });
      const paused =
        globalPause &&
        typeof globalPause.value === 'object' &&
        globalPause.value !== null &&
        (globalPause.value as { paused?: boolean }).paused === true;
      if (paused) {
        this.logger.debug('Global automation pause active — skipping planner');
        await this.orchestrator.recoverStalled();
        return;
      }

      const rollout = await this.prisma.setting.findUnique({
        where: { key: 'system:rolloutStage' },
      });
      const stage =
        (rollout?.value as { stage?: string } | null)?.stage ??
        this.config.get<string>('ops.rolloutStage', 'A');
      if (stage === 'A' || stage === 'B') {
        this.logger.debug(`Rollout stage ${stage} — automation planning disabled`);
        await this.orchestrator.recoverStalled();
        return;
      }

      await this.orchestrator.recoverStalled();
      await this.enqueueGlobalPublishTick();

      const configs = await this.prisma.automationConfig.findMany({
        where: {
          enabled: true,
          runMode: AutomationRunMode.ENABLED,
        },
        select: { userId: true, dailyGenerationTarget: true },
        take: 100,
      });

      for (const config of configs) {
        // Stage D: force at most 1 video/day until full operation
        if (stage === 'D' && config.dailyGenerationTarget > 1) {
          await this.prisma.automationConfig.update({
            where: { userId: config.userId },
            data: { dailyGenerationTarget: 1 },
          });
        }
        await this.planner.enqueueDailyPlanner(config.userId, { mode: 'daily' });
      }

      const dueSchedules = await this.prisma.contentSchedule.findMany({
        where: {
          status: { in: ['PLANNED', 'QUEUED', 'GENERATING', 'RENDERING', 'SCHEDULING_PUBLISH'] },
          OR: [
            { scheduledGenerationAt: { lte: new Date() } },
            { scheduledGenerationAt: null },
          ],
        },
        select: { id: true, userId: true },
        take: 40,
      });
      for (const schedule of dueSchedules) {
        await this.orchestrator.enqueueAdvance(schedule.userId, schedule.id, 'advance');
      }
    } catch (error) {
      this.logger.error(`Automation cron tick failed: ${(error as Error).message}`);
    }
  }

  async enqueueGlobalPublishTick() {
    const queue = this.queueService.getQueue(QUEUE_NAMES.AUTOMATION_PUBLISH_SCHEDULER);
    const minuteKey = new Date().toISOString().slice(0, 16);
    await queue.add(
      'tick',
      { mode: 'tick' as const },
      { jobId: `auto-pub-global-${minuteKey}`, removeOnComplete: 20, removeOnFail: 50 },
    );
  }
}
