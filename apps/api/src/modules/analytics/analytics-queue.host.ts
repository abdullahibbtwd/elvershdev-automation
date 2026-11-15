import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QUEUE_NAMES,
  type AnalyticsAggregationPayload,
  type AnalyticsPostRefreshPayload,
  type AnalyticsSyncQueuePayload,
} from '@ai-video/shared';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { shouldRunQueueHosts } from '../../common/process-role';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsSyncService } from './analytics-sync.service';

@Injectable()
export class AnalyticsQueueHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsQueueHost.name);
  private readonly workers: Worker[] = [];
  private connection: IORedis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly sync: AnalyticsSyncService,
    private readonly aggregation: AnalyticsAggregationService,
  ) {}

  async onModuleInit() {
    if (!shouldRunQueueHosts()) {
      this.logger.log('Analytics queue host skipped (PROCESS_ROLE does not own queue hosts)');
      return;
    }
    if (process.env.ANALYTICS_QUEUE_HOST_DISABLED === 'true') return;
    this.connection = new IORedis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      maxRetriesPerRequest: null,
    });
    this.workers.push(
      new Worker(
        QUEUE_NAMES.ANALYTICS_SYNC,
        (job: Job<AnalyticsSyncQueuePayload>) => this.sync.processSync(job.data),
        { connection: this.connection, concurrency: 2 },
      ),
      new Worker(
        QUEUE_NAMES.ANALYTICS_POST_REFRESH,
        (job: Job<AnalyticsPostRefreshPayload>) => this.sync.refreshPost(job.data),
        { connection: this.connection, concurrency: 4 },
      ),
      new Worker(
        QUEUE_NAMES.ANALYTICS_ACCOUNT_REFRESH,
        (job: Job<AnalyticsSyncQueuePayload>) => this.sync.processSync(job.data),
        { connection: this.connection, concurrency: 2 },
      ),
      new Worker(
        QUEUE_NAMES.ANALYTICS_AGGREGATION,
        async (job: Job<AnalyticsAggregationPayload>) => {
          if (job.data.videoRenderId) {
            return this.aggregation.aggregateVideo(job.data.userId, job.data.videoRenderId);
          }
          const from = job.data.dateFrom ? new Date(job.data.dateFrom) : new Date(Date.now() - 90 * 86_400_000);
          const to = job.data.dateTo ? new Date(job.data.dateTo) : new Date();
          return this.aggregation.rollupContent(job.data.userId, from, to);
        },
        { connection: this.connection, concurrency: 2 },
      ),
    );
    for (const worker of this.workers) {
      worker.on('failed', (job, error) =>
        this.logger.error(`Analytics job ${job?.name}/${job?.id} failed: ${error.message}`),
      );
    }
    this.logger.log(
      `Analytics queue host listening on ${this.workers.map((worker) => worker.name).join(', ')}`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    if (this.connection) await this.connection.quit();
  }
}
