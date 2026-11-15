import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_QUEUE_NAMES,
  JOB_TYPE_TO_QUEUE,
  QUEUE_NAMES,
  type GenerationJobTypeKey,
  type GenerationQueuePayload,
  type QueueName,
} from '@ai-video/shared';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly config: ConfigService) {
    this.connection = new IORedis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      maxRetriesPerRequest: null,
    });

    for (const name of ALL_QUEUE_NAMES) {
      this.queues.set(
        name,
        new Queue(name, {
          connection: this.connection,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 200,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        }),
      );
    }
  }

  getQueue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Unknown queue: ${name}`);
    }
    return queue;
  }

  getQueueForJobType(jobType: GenerationJobTypeKey): Queue {
    return this.getQueue(JOB_TYPE_TO_QUEUE[jobType]);
  }

  get queueNames() {
    return QUEUE_NAMES;
  }

  async enqueueGenerationJob(
    jobType: GenerationJobTypeKey,
    data: GenerationQueuePayload,
    options?: JobsOptions,
  ) {
    const queueName = JOB_TYPE_TO_QUEUE[jobType];
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobType.toLowerCase(), data, {
      jobId: data.generationJobId,
      attempts: options?.attempts ?? 3,
      ...options,
    });
    return { queueName, job };
  }

  async removeJob(queueName: QueueName, jobId: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      return false;
    }
    const state = await job.getState();
    if (state === 'active') {
      return false;
    }
    await job.remove();
    return true;
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection.quit();
  }
}
