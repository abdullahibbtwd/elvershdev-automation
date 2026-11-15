import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemAlertSeverity } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from './alerts.service';
import { OpsService } from './ops.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class OpsMonitorCron {
  private readonly logger = new Logger(OpsMonitorCron.name);

  constructor(
    private readonly locks: DistributedLockService,
    private readonly ops: OpsService,
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!shouldRunSchedulers()) return;
    if (process.env.OPS_MONITOR_DISABLED === 'true') return;
    const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 55);
    const { acquired } = await this.locks.withLock('cron:ops-monitor', ttl, async () => {
      await this.inspect();
    });
    if (!acquired) {
      this.logger.debug('Ops monitor lock not acquired — another API replica is leader');
    }
  }

  private async inspect() {
    const health = await this.ops.getSystemHealth();

    const map: Array<{
      ok: boolean;
      type: Parameters<AlertsService['fire']>[0]['type'];
      key: string;
      title: string;
      body: string;
      severity?: SystemAlertSeverity;
    }> = [
      {
        ok: health.components.database.status === 'up',
        type: 'database_failure',
        key: 'infra:database',
        title: 'Database connectivity failure',
        body: 'PostgreSQL health check failed',
        severity: SystemAlertSeverity.CRITICAL,
      },
      {
        ok: health.components.redis.status === 'up',
        type: 'redis_failure',
        key: 'infra:redis',
        title: 'Redis connectivity failure',
        body: 'Redis health check failed',
        severity: SystemAlertSeverity.CRITICAL,
      },
      {
        ok: health.components.minio.status === 'up',
        type: 'minio_failure',
        key: 'infra:minio',
        title: 'MinIO storage failure',
        body: 'MinIO health check failed',
        severity: SystemAlertSeverity.CRITICAL,
      },
      {
        ok: health.components.worker.status === 'up',
        type: 'worker_down',
        key: 'infra:worker',
        title: 'Worker unavailable',
        body: 'Worker health endpoint is not reachable',
        severity: SystemAlertSeverity.CRITICAL,
      },
    ];

    for (const item of map) {
      if (!item.ok) {
        await this.alerts.fire({
          type: item.type,
          dedupeKey: item.key,
          title: item.title,
          body: item.body,
          severity: item.severity,
        });
      } else {
        await this.alerts.resolve(item.key, `${item.title} recovered`);
      }
    }

    const diskThreshold = this.config.get<number>('ops.diskUsageAlertPercent', 85);
    const diskPercent = await this.readDiskUsedPercent();
    if (diskPercent >= diskThreshold) {
      await this.alerts.fire({
        type: 'disk_usage',
        dedupeKey: 'infra:disk',
        title: 'Disk usage threshold exceeded',
        body: `Disk usage at ${diskPercent}% (threshold ${diskThreshold}%)`,
        severity:
          diskPercent >= 95 ? SystemAlertSeverity.CRITICAL : SystemAlertSeverity.WARNING,
        metadata: { diskPercent },
      });
    } else {
      await this.alerts.resolve('infra:disk', 'Disk usage recovered');
    }

    const memThreshold = this.config.get<number>('ops.memoryAlertPercent', 90);
    if (health.resources.memory.usedPercent >= memThreshold) {
      await this.alerts.fire({
        type: 'memory_pressure',
        dedupeKey: 'infra:memory',
        title: 'Memory pressure',
        body: `Host memory at ${health.resources.memory.usedPercent}%`,
        metadata: health.resources.memory,
      });
    } else {
      await this.alerts.resolve('infra:memory', 'Memory pressure recovered');
    }

    const highFail = health.queues.filter(
      (q) => typeof q.failed === 'number' && (q.failed as number) > 25,
    );
    if (highFail.length) {
      await this.alerts.fire({
        type: 'queue_failures',
        dedupeKey: 'queues:failures',
        title: 'Elevated queue failure counts',
        body: highFail.map((q) => `${q.name}:${q.failed}`).join(', '),
        metadata: { queues: highFail },
      });
    } else {
      await this.alerts.resolve('queues:failures', 'Queue failure counts normalized');
    }

    // Expired OAuth / disconnected channels
    const expired = await this.prisma.socialChannel.count({
      where: {
        OR: [
          { connectionStatus: 'EXPIRED' },
          { tokenExpiresAt: { lt: new Date() }, refreshTokenEncrypted: null },
        ],
      },
    });
    if (expired > 0) {
      await this.alerts.fire({
        type: 'oauth_expired',
        dedupeKey: 'social:oauth-expired',
        title: 'Expired OAuth credentials detected',
        body: `${expired} channel(s) have expired or invalid credentials`,
        metadata: { count: expired },
      });
    } else {
      await this.alerts.resolve('social:oauth-expired', 'OAuth credentials healthy');
    }

    const backlogThreshold = this.config.get<number>('ops.queueBacklogAlertThreshold', 100);
    const backlog = health.queues.filter(
      (q) => typeof q.waiting === 'number' && (q.waiting as number) >= backlogThreshold,
    );
    if (backlog.length) {
      await this.alerts.fire({
        type: 'queue_backlog',
        dedupeKey: 'queues:backlog',
        title: 'Queue backlog threshold exceeded',
        body: backlog.map((q) => `${q.name}:${q.waiting}`).join(', '),
        severity: SystemAlertSeverity.WARNING,
        metadata: { queues: backlog, threshold: backlogThreshold },
      });
    } else {
      await this.alerts.resolve('queues:backlog', 'Queue backlog recovered');
    }

    const spendThreshold = this.config.get<number>('ops.providerSpendAlertUsd', 50);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const spendAgg = await this.prisma.providerUsage
      .aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { estimatedCost: true },
      })
      .catch(() => null);
    const spendUsd = Number(spendAgg?._sum?.estimatedCost ?? 0);
    if (spendUsd >= spendThreshold) {
      await this.alerts.fire({
        type: 'provider_spend',
        dedupeKey: 'providers:spend-day',
        title: 'Daily provider spend threshold exceeded',
        body: `Estimated spend today $${spendUsd.toFixed(2)} (threshold $${spendThreshold})`,
        severity: SystemAlertSeverity.WARNING,
        metadata: { spendUsd, spendThreshold },
      });
    } else {
      await this.alerts.resolve('providers:spend-day', 'Provider spend within threshold');
    }

    const staleHours = this.config.get<number>('ops.backupStaleHours', 36);
    const lastBackup = await this.prisma.backupRecord.findFirst({
      where: { status: { in: ['SUCCESS', 'VERIFIED'] } },
      orderBy: { completedAt: 'desc' },
    });
    const staleMs = staleHours * 3600_000;
    const backupStale =
      !lastBackup?.completedAt || Date.now() - lastBackup.completedAt.getTime() > staleMs;
    if (backupStale) {
      await this.alerts.fire({
        type: 'backup_failed',
        dedupeKey: 'backup:stale',
        title: 'Backup missing or stale',
        body: lastBackup?.completedAt
          ? `Last successful backup at ${lastBackup.completedAt.toISOString()}`
          : 'No successful backup recorded',
        severity: SystemAlertSeverity.CRITICAL,
        metadata: { lastBackupId: lastBackup?.id ?? null, staleHours },
      });
    } else {
      await this.alerts.resolve('backup:stale', 'Backup freshness recovered');
    }
  }

  private async readDiskUsedPercent(): Promise<number> {
    try {
      const { stdout } = await execFileAsync('df', ['-P', '/']);
      const lines = stdout.trim().split('\n');
      const parts = lines[lines.length - 1]?.split(/\s+/) ?? [];
      const used = parts[4]?.replace('%', '');
      const value = Number.parseInt(used ?? '0', 10);
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
}
