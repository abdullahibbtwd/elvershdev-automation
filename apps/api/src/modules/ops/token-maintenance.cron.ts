import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QUEUE_NAMES } from '@ai-video/shared';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';

/**
 * Enqueues social-token-maintenance jobs so OAuth refresh runs on a schedule.
 * The worker processor already exists; Phase 12 wires the missing scheduler.
 */
@Injectable()
export class TokenMaintenanceCron {
  private readonly logger = new Logger(TokenMaintenanceCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick() {
    if (!shouldRunSchedulers()) return;
    if (process.env.TOKEN_MAINTENANCE_CRON_DISABLED === 'true') return;
    const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 240);
    await this.locks.withLock('cron:token-maintenance', ttl, async () => {
      const soon = new Date(Date.now() + 60 * 60_000);
      const channels = await this.prisma.socialChannel.findMany({
        where: {
          isActive: true,
          OR: [
            { tokenExpiresAt: { lte: soon } },
            { connectionStatus: { in: ['EXPIRED', 'ERROR'] } },
          ],
        },
        select: { id: true, userId: true, platform: true },
        take: 200,
      });

      const queue = this.queues.getQueue(QUEUE_NAMES.SOCIAL_TOKEN_MAINTENANCE);
      for (const channel of channels) {
        const jobId = `token-maint-${channel.id}-${new Date().toISOString().slice(0, 13)}`;
        await queue.add(
          'refresh',
          {
            channelId: channel.id,
            userId: channel.userId,
            platform: channel.platform,
          },
          {
            jobId,
            removeOnComplete: 50,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
          },
        );
      }
      if (channels.length) {
        this.logger.log(`Enqueued token maintenance for ${channels.length} channel(s)`);
      }
    });
  }
}
