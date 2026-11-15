import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsSyncService } from './analytics-sync.service';

@Injectable()
export class AnalyticsCronService {
  private readonly logger = new Logger(AnalyticsCronService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: AnalyticsSyncService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    if (!shouldRunSchedulers()) return;
    if (process.env.ANALYTICS_CRON_DISABLED === 'true' || this.running) return;
    this.running = true;
    try {
      const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 3000);
      const { acquired } = await this.locks.withLock('cron:analytics', ttl, async () => {
        await this.sync.recover();
        const users = await this.prisma.socialChannel.findMany({
          where: { isActive: true },
          select: { userId: true },
          distinct: ['userId'],
          take: 500,
        });
        for (const { userId } of users) {
          try {
            await this.sync.startPeriodic(userId);
          } catch (error) {
            this.logger.warn(
              `Could not enqueue periodic analytics for ${userId}: ${(error as Error).message}`,
            );
          }
        }
      });
      if (!acquired) {
        this.logger.debug('Analytics cron lock not acquired — skipping duplicate tick');
      }
    } catch (error) {
      this.logger.error(`Analytics recovery tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
