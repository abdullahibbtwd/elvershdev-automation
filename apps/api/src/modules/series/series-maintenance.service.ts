import { Injectable, Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@ai-video/shared';
import {
  SeriesEpisodeProductionState,
  SeriesEpisodeStatus,
  SeriesProductionRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';

@Injectable()
export class SeriesMaintenanceService {
  private readonly logger = new Logger(SeriesMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
    private readonly queues: QueueService,
  ) {}

  async run(mode: 'recover_stuck' | 'missed_schedules' | 'cleanup' | 'disk_check' = 'recover_stuck') {
    switch (mode) {
      case 'missed_schedules':
        return this.publishScheduler.markMissedSchedules();
      case 'cleanup':
        return this.cleanupStalePlanning();
      case 'disk_check':
        return {
          ok: true,
          note: 'Disk checks remain on Ops CleanupService; Series passes asset IDs only.',
        };
      case 'recover_stuck':
      default:
        return this.recoverStuck();
    }
  }

  async recoverStuck() {
    const publish = await this.publishScheduler.reconcile();

    const stuckEpisodes = await this.prisma.seriesEpisode.updateMany({
      where: {
        status: SeriesEpisodeStatus.SCRIPTING,
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      data: {
        status: SeriesEpisodeStatus.FAILED,
        lastError: 'Recovered stuck SCRIPTING episode',
        productionState: SeriesEpisodeProductionState.FAILED,
      },
    });

    const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
    const stuckRuns = await this.prisma.seriesProductionRun.findMany({
      where: {
        status: {
          in: [
            SeriesProductionRunStatus.PENDING,
            SeriesProductionRunStatus.RUNNING,
            SeriesProductionRunStatus.RETRYING,
          ],
        },
        updatedAt: { lt: staleBefore },
      },
      take: 25,
    });

    let requeued = 0;
    for (const run of stuckRuns) {
      await this.queues.getQueue(QUEUE_NAMES.SERIES_EPISODE_PRODUCTION).add(
        'recover',
        {
          userId: run.userId,
          seriesId: run.seriesId,
          episodeId: run.episodeId,
          productionRunId: run.id,
          action: 'recover' as const,
          useMockAi: process.env.GEMINI_USE_MOCK === 'true',
        },
        { jobId: `series-prod-recover-${run.id}-${Date.now()}` },
      );
      requeued += 1;
    }

    this.logger.debug(
      `Series maintenance recovered publish=${publish.recovered} episodes=${stuckEpisodes.count} runsRequeued=${requeued}`,
    );

    return {
      publish,
      stuckEpisodes: stuckEpisodes.count,
      stuckRunsRequeued: requeued,
    };
  }

  private async cleanupStalePlanning() {
    const failedPlans = await this.prisma.seriesReplacementPlan.count({
      where: {
        status: 'FAILED',
        updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    return { staleFailedReplacementPlans: failedPlans };
  }
}
