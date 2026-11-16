import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeriesExecutionStatus, Prisma } from '@prisma/client';
import {
  QUEUE_NAMES,
  type SeriesCharacterGenerationPayload,
  type SeriesContinuityValidationPayload,
  type SeriesEpisodePlanningPayload,
  type SeriesEpisodeProductionPayload,
  type SeriesMaintenancePayload,
  type SeriesPublishingPayload,
  type SeriesReplacementPlanningPayload,
  type SeriesStoryPlanningPayload,
} from '@ai-video/shared';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { shouldRunQueueHosts } from '../../common/process-role';
import { PrismaService } from '../../prisma/prisma.service';
import { CharacterDirectorService } from './character-director.service';
import { ContinuityEngineService } from './continuity-engine.service';
import { EpisodeDirectorService } from './episode-director.service';
import { MovieArchitectService } from './movie-architect.service';
import { SeriesMaintenanceService } from './series-maintenance.service';
import { SeriesOrchestratorService } from './series-orchestrator.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';
import { SeriesReplacementService } from './series-replacement.service';
import type { GenerateSeriesDto } from './dto/generate-series.dto';

type StoryPlanningJob = SeriesStoryPlanningPayload & {
  request?: GenerateSeriesDto;
};

@Injectable()
export class SeriesQueueHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SeriesQueueHost.name);
  private readonly workers: Worker[] = [];
  private connection: IORedis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly architect: MovieArchitectService,
    private readonly characters: CharacterDirectorService,
    private readonly episodes: EpisodeDirectorService,
    private readonly continuity: ContinuityEngineService,
    private readonly replacements: SeriesReplacementService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
    private readonly orchestrator: SeriesOrchestratorService,
    private readonly maintenance: SeriesMaintenanceService,
  ) {}

  private async settleStoryPlanningExecution(
    job: Job | undefined,
    outcome: 'COMPLETED' | 'FAILED',
    errorMessage?: string,
    seriesId?: string,
  ) {
    const jobId = job?.id != null ? String(job.id) : null;
    if (!jobId) return;
    try {
      await this.prisma.seriesExecution.updateMany({
        where: {
          status: {
            in: [SeriesExecutionStatus.QUEUED, SeriesExecutionStatus.RUNNING],
          },
          queueJobIds: { array_contains: [jobId] },
        },
        data: {
          status:
            outcome === 'COMPLETED'
              ? SeriesExecutionStatus.COMPLETED
              : SeriesExecutionStatus.FAILED,
          completedAt: new Date(),
          errorMessage: errorMessage?.slice(0, 2000) ?? null,
          ...(seriesId ? { seriesId } : {}),
          resultSummary: {
            awaitingSchedulerWorker: false,
            workerOutcome: outcome,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not settle SeriesExecution for job ${jobId}: ${(error as Error).message}`,
      );
    }
  }

  async onModuleInit() {
    if (!shouldRunQueueHosts()) {
      this.logger.log('Series queue host skipped (PROCESS_ROLE does not own queue hosts)');
      return;
    }
    if (process.env.SERIES_QUEUE_HOST_DISABLED === 'true') {
      this.logger.warn('Series queue host disabled');
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
        QUEUE_NAMES.SERIES_STORY_PLANNING,
        async (job: Job<StoryPlanningJob>) => {
          const request = job.data.request ?? {
            laneId: job.data.laneId,
            useMockAi: job.data.useMockAi,
            asReplacementCandidate: false,
            setAsActive: true,
          };
          const planned = await this.architect.planAndPersist(job.data.userId, {
            ...request,
            laneId: job.data.laneId,
            useMockAi: job.data.useMockAi ?? request.useMockAi,
            async: false,
          });
          await this.settleStoryPlanningExecution(
            job,
            'COMPLETED',
            undefined,
            (planned as { id?: string } | null)?.id,
          );
          return planned;
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_CHARACTER_GENERATION,
        async (job: Job<SeriesCharacterGenerationPayload>) => {
          if (job.data.characterId) {
            return this.characters.generateReferencePortrait({
              userId: job.data.userId,
              seriesId: job.data.seriesId,
              characterId: job.data.characterId,
            });
          }
          return this.characters.generateReferencesForSeries(
            job.data.userId,
            job.data.seriesId,
          );
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_EPISODE_PLANNING,
        async (job: Job<SeriesEpisodePlanningPayload>) => {
          return this.episodes.planAndPersist(
            job.data.userId,
            job.data.seriesId,
            job.data.episodeId,
            {
              useMockAi: job.data.useMockAi,
              regenerate: job.data.force === true,
            },
          );
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_EPISODE_PRODUCTION,
        async (job: Job<SeriesEpisodeProductionPayload>) => {
          // Cron may enqueue bare `start` without a run id — bootstrap via startProduction.
          if (job.data.action === 'start' && !job.data.productionRunId) {
            return this.orchestrator.startProduction(
              job.data.userId,
              job.data.seriesId,
              job.data.episodeId,
              {
                useMockAi: job.data.useMockAi,
                force: job.data.force,
                async: false,
              },
            );
          }
          return this.orchestrator.advanceProduction(job.data);
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_CONTINUITY_VALIDATION,
        async (job: Job<SeriesContinuityValidationPayload>) => {
          return this.continuity.validateEpisode({
            userId: job.data.userId,
            seriesId: job.data.seriesId,
            episodeId: job.data.episodeId,
            stage: job.data.stage,
            useMockAi: job.data.useMockAi,
          });
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_REPLACEMENT_PLANNING,
        async (job: Job<SeriesReplacementPlanningPayload>) => {
          if (!job.data.replacementPlanId) {
            const requested = await this.replacements.requestReplacement(
              job.data.userId,
              job.data.laneId,
              {
                sourceSeriesId: job.data.sourceSeriesId,
                mode: job.data.mode,
                async: false,
                useMockAi: job.data.useMockAi,
                force: job.data.force,
              },
            );
            return requested;
          }
          return this.replacements.executePlanning(
            job.data.userId,
            job.data.replacementPlanId,
            { useMockAi: job.data.useMockAi },
          );
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_PUBLISHING,
        async (job: Job<SeriesPublishingPayload>) => {
          if (job.data.mode === 'enqueue_one' && job.data.seriesScheduleId) {
            return this.publishScheduler.enqueueOne(job.data.seriesScheduleId, {
              userId: job.data.userId,
              force: job.data.force,
              useMockSocial: job.data.useMockSocial,
            });
          }
          if (job.data.mode === 'recover') {
            return this.publishScheduler.reconcile(job.data.userId);
          }
          return this.publishScheduler.processDuePublications(job.data);
        },
        { connection: this.connection, concurrency: 1 },
      ),
      new Worker(
        QUEUE_NAMES.SERIES_MAINTENANCE,
        async (job: Job<SeriesMaintenancePayload>) => {
          return this.maintenance.run(job.data.mode);
        },
        { connection: this.connection, concurrency: 1 },
      ),
    );

    for (const worker of this.workers) {
      worker.on('failed', (job, error) => {
        this.logger.error(
          `Series job ${job?.name}/${job?.id} failed: ${error.message}`,
        );
        if (worker.name === QUEUE_NAMES.SERIES_STORY_PLANNING) {
          void this.settleStoryPlanningExecution(job, 'FAILED', error.message);
        }
      });
    }

    this.logger.log(
      `Series queue host listening on ${this.workers.map((w) => w.name).join(', ')}`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
