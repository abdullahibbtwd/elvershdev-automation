import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QUEUE_NAMES,
  type AutomationDailyPlannerPayload,
  type AutomationOrchestratorPayload,
  type AutomationPublishSchedulerPayload,
} from '@ai-video/shared';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { shouldRunQueueHosts } from '../../common/process-role';
import { AutomationOrchestratorService } from './automation-orchestrator.service';
import { AutomationPublishSchedulerService } from './automation-publish-scheduler.service';
import { ContentPlannerService } from './content-planner.service';

@Injectable()
export class AutomationQueueHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationQueueHost.name);
  private readonly workers: Worker[] = [];
  private connection: IORedis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly planner: ContentPlannerService,
    private readonly orchestrator: AutomationOrchestratorService,
    private readonly publishScheduler: AutomationPublishSchedulerService,
  ) {}

  async onModuleInit() {
    if (!shouldRunQueueHosts()) {
      this.logger.log('Automation queue host skipped (PROCESS_ROLE does not own queue hosts)');
      return;
    }
    if (process.env.AUTOMATION_QUEUE_HOST_DISABLED === 'true') {
      this.logger.warn('Automation queue host disabled');
      return;
    }

    this.connection = new IORedis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      maxRetriesPerRequest: null,
    });

    this.workers.push(
      new Worker(
        QUEUE_NAMES.AUTOMATION_DAILY_PLANNER,
        async (job: Job<AutomationDailyPlannerPayload>) => {
          const result = await this.planner.planDailyForUser(job.data.userId, {
            force: job.data.force,
            planDate: job.data.planDate,
          });
          return result;
        },
        { connection: this.connection, concurrency: 2 },
      ),
      new Worker(
        QUEUE_NAMES.AUTOMATION_ORCHESTRATOR,
        async (job: Job<AutomationOrchestratorPayload>) => {
          return this.orchestrator.advanceSchedule(job.data);
        },
        { connection: this.connection, concurrency: 2 },
      ),
      new Worker(
        QUEUE_NAMES.AUTOMATION_PUBLISH_SCHEDULER,
        async (job: Job<AutomationPublishSchedulerPayload>) => {
          if (job.data.mode === 'enqueue_one' && job.data.scheduledPublicationId) {
            return this.publishScheduler.enqueueOne(
              job.data.scheduledPublicationId,
              job.data.force === true,
            );
          }
          const due = await this.publishScheduler.processDuePublications(job.data);
          const reconciled = await this.publishScheduler.reconcilePublicationOutcomes(
            job.data.userId,
          );
          return { ...due, ...reconciled };
        },
        { connection: this.connection, concurrency: 2 },
      ),
    );

    for (const worker of this.workers) {
      worker.on('failed', (job, error) => {
        this.logger.error(
          `Automation job ${job?.name}/${job?.id} failed: ${error.message}`,
        );
      });
    }

    this.logger.log(
      `Automation queue host listening on ${this.workers.map((w) => w.name).join(', ')}`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
