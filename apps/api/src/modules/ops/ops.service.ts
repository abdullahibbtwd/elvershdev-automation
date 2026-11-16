import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_QUEUE_NAMES,
  JOB_TYPE_TO_QUEUE,
  QUEUE_NAMES,
  type GenerationJobTypeKey,
} from '@ai-video/shared';
import { BackupStatus, JobStatus, Prisma, SystemAlertStatus, UserRole } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { AlertsService } from './alerts.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class OpsService {
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly alerts: AlertsService,
  ) {}

  getVersion() {
    return {
      version: process.env.APP_VERSION ?? '0.1.0',
      environment: this.config.get<string>('nodeEnv', 'development'),
      rolloutStage: this.config.get<string>('ops.rolloutStage', 'A'),
      node: process.version,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getSystemHealth() {
    const [database, redis, minio, worker, disk, memory] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkWorker(),
      this.getDiskUsage(),
      this.getMemoryUsage(),
    ]);

    const queues = await this.getQueueHealth();
    const lastBackup = await this.prisma.backupRecord.findFirst({
      where: { status: { in: [BackupStatus.SUCCESS, BackupStatus.VERIFIED] } },
      orderBy: { completedAt: 'desc' },
    });
    const lastAnalyticsSync = await this.prisma.analyticsSyncJob.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, userId: true },
    });

    const providers = this.getProviderConnectivity();

    return {
      ...this.getVersion(),
      components: { database, redis, minio, worker, api: { status: 'up' as const } },
      queues,
      resources: { disk, memory, cpuCount: os.cpus().length, loadAvg: os.loadavg() },
      providers,
      lastSuccessfulBackup: lastBackup,
      lastSuccessfulAnalyticsSync: lastAnalyticsSync,
      openAlerts: await this.prisma.systemAlert.count({
        where: { status: SystemAlertStatus.OPEN },
      }),
    };
  }

  async getQueueHealth() {
    const result: Array<Record<string, unknown>> = [];
    for (const name of ALL_QUEUE_NAMES) {
      try {
        const queue = this.queues.getQueue(name);
        const [waiting, active, delayed, failed, completed, paused] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getDelayedCount(),
          queue.getFailedCount(),
          queue.getCompletedCount(),
          queue.isPaused(),
        ]);
        result.push({
          name,
          waiting,
          active,
          delayed,
          failed,
          completed,
          paused,
        });
      } catch (error) {
        result.push({ name, error: (error as Error).message });
      }
    }
    return result;
  }

  async getActiveJobs(limit = 50) {
    return this.prisma.generationJob.findMany({
      where: { status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] } },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        jobType: true,
        status: true,
        progress: true,
        queueName: true,
        userId: true,
        storyId: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getFailedJobs(limit = 50) {
    return this.prisma.generationJob.findMany({
      where: { status: JobStatus.FAILED },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        jobType: true,
        status: true,
        queueName: true,
        userId: true,
        storyId: true,
        errorMessage: true,
        attempts: true,
        updatedAt: true,
      },
    });
  }

  async pauseQueue(queueName: string) {
    this.assertKnownQueue(queueName);
    const queue = this.queues.getQueue(queueName as Parameters<QueueService['getQueue']>[0]);
    await queue.pause();
    return { queueName, paused: true };
  }

  async resumeQueue(queueName: string) {
    this.assertKnownQueue(queueName);
    const queue = this.queues.getQueue(queueName as Parameters<QueueService['getQueue']>[0]);
    await queue.resume();
    return { queueName, paused: false };
  }

  async retryFailedJob(generationJobId: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id: generationJobId } });
    if (!job || job.status !== JobStatus.FAILED) {
      throw new BadRequestException('Job is not in FAILED status');
    }
    const jobType = job.jobType as GenerationJobTypeKey;
    const queueName = JOB_TYPE_TO_QUEUE[jobType];
    if (job.queueJobId) {
      await this.queues.removeJob(queueName, job.queueJobId);
    }
    await this.queues.removeJob(queueName, job.id);

    const payload =
      job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : {};

    await this.prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.PENDING,
        progress: 0,
        errorMessage: null,
        attempts: 0,
        queueJobId: null,
        result: Prisma.JsonNull,
      },
    });

    const { job: bullJob } = await this.queues.enqueueGenerationJob(jobType, {
      generationJobId: job.id,
      userId: job.userId,
      videoProjectId: job.videoProjectId,
      storyId: job.storyId,
      jobType,
      provider: job.provider,
      payload,
    });

    await this.prisma.generationJob.update({
      where: { id: job.id },
      data: { status: JobStatus.QUEUED, queueJobId: bullJob.id, queueName },
    });
    return { id: job.id, requeued: true, queueJobId: bullJob.id };
  }

  async triggerBackup() {
    const record = await this.prisma.backupRecord.create({
      data: { type: 'postgres', status: BackupStatus.PENDING },
    });
    const script = path.resolve(process.cwd(), '../../scripts/backup-postgres.sh');
    try {
      await fs.access(script);
      const { stdout, stderr } = await execFileAsync('bash', [script], {
        env: process.env,
        timeout: 600_000,
      });
      const markerPath = path.resolve(process.cwd(), '../../backups/postgres/last_success.json');
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(await fs.readFile(markerPath, 'utf8')) as Record<string, unknown>;
      } catch {
        // ignore
      }
      return this.prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: BackupStatus.SUCCESS,
          completedAt: new Date(),
          fileName: typeof meta.file === 'string' ? meta.file : undefined,
          fileSizeBytes:
            typeof meta.bytes === 'number' ? BigInt(meta.bytes) : undefined,
          destination: 'backups/postgres',
          metadata: { stdout: stdout.slice(-2000), stderr: stderr.slice(-1000), ...meta },
        },
      });
    } catch (error) {
      await this.alerts.fire({
        type: 'backup_failed',
        dedupeKey: 'backup:postgres:failed',
        title: 'Database backup failed',
        body: (error as Error).message,
        severity: 'CRITICAL' as never,
      });
      return this.prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: BackupStatus.FAILED,
          completedAt: new Date(),
          errorMessage: (error as Error).message,
        },
      });
    }
  }

  async runDiagnostics() {
    const health = await this.getSystemHealth();
    const issues: string[] = [];
    for (const [name, component] of Object.entries(health.components)) {
      if ((component as { status?: string }).status !== 'up') {
        issues.push(`${name} is not healthy`);
      }
    }
    const failedQueues = health.queues.filter(
      (q) => typeof q.failed === 'number' && (q.failed as number) > 50,
    );
    if (failedQueues.length) {
      issues.push(`Queues with high failure counts: ${failedQueues.map((q) => q.name).join(', ')}`);
    }
    if (health.resources.disk && health.resources.disk.usedPercent >= 85) {
      issues.push(`Disk usage high: ${health.resources.disk.usedPercent}%`);
    }
    return { ok: issues.length === 0, issues, health };
  }

  async setGlobalAutomationPause(paused: boolean) {
    const key = 'system:automation:globalPause';
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: { paused } },
      update: { value: { paused } },
    });
    if (paused) {
      await this.prisma.automationConfig.updateMany({
        where: { runMode: 'ENABLED' },
        data: { runMode: 'PAUSED', pausedAt: new Date(), enabled: false },
      });
    }
    return { globalPause: paused };
  }

  async getRolloutStage() {
    const key = 'system:rolloutStage';
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const fromDb =
      row && typeof row.value === 'object' && row.value && 'stage' in (row.value as object)
        ? String((row.value as { stage: string }).stage)
        : null;
    return {
      stage: fromDb ?? this.config.get<string>('ops.rolloutStage', 'A'),
      allowed: ['A', 'B', 'C', 'D', 'E'],
      description: {
        A: 'Infrastructure only',
        B: 'Internal mock testing',
        C: 'Controlled live testing',
        D: 'Limited automation (1 video/day)',
        E: 'Full operation (configured daily target)',
      },
    };
  }

  async setRolloutStage(stage: string) {
    if (!['A', 'B', 'C', 'D', 'E'].includes(stage)) {
      throw new BadRequestException('Invalid rollout stage');
    }
    const key = 'system:rolloutStage';
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: { stage } },
      update: { value: { stage } },
    });
    return this.getRolloutStage();
  }

  async promoteAdmin(email: string) {
    const adminCount = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
    if (adminCount < 1) {
      throw new BadRequestException(
        'No administrator exists yet. Use POST /api/ops/bootstrap-admin with ADMIN_BOOTSTRAP_TOKEN.',
      );
    }
    const user = await this.prisma.user.update({
      where: { email: email.toLowerCase().trim() },
      data: { role: UserRole.ADMIN },
      select: { id: true, email: true, role: true, name: true },
    });
    await this.prisma.automationAuditLog.create({
      data: {
        userId: user.id,
        action: 'ops.promote_admin',
        before: { role: 'EDITOR' },
        after: { role: user.role, email: user.email },
      },
    });
    return user;
  }

  /**
   * One-time bootstrap when the system has zero ADMIN users.
   * Requires ADMIN_BOOTSTRAP_TOKEN; becomes unavailable after the first success.
   */
  async bootstrapAdmin(email: string, token: string) {
    const expected = this.config.get<string>('ops.adminBootstrapToken');
    if (!expected || expected.length < 16) {
      throw new BadRequestException(
        'ADMIN_BOOTSTRAP_TOKEN is not configured (min 16 chars). Bootstrap unavailable.',
      );
    }
    if (token !== expected) {
      throw new BadRequestException('Invalid bootstrap token');
    }

    const done = await this.prisma.setting.findUnique({
      where: { key: 'system:adminBootstrap:completed' },
    });
    if (done) {
      throw new BadRequestException('Administrator bootstrap already completed');
    }

    const adminCount = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
    if (adminCount > 0) {
      await this.prisma.setting.upsert({
        where: { key: 'system:adminBootstrap:completed' },
        create: {
          key: 'system:adminBootstrap:completed',
          value: { completedAt: new Date().toISOString(), reason: 'admin_already_exists' },
        },
        update: {
          value: { completedAt: new Date().toISOString(), reason: 'admin_already_exists' },
        },
      });
      throw new BadRequestException(
        'An administrator already exists. Bootstrap is unavailable; use promote-admin.',
      );
    }

    const normalized = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!existing) {
      throw new BadRequestException(
        'User must already exist (create via seed/DB). Public registration is disabled.',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: { role: UserRole.ADMIN },
      select: { id: true, email: true, role: true, name: true },
    });

    await this.prisma.setting.create({
      data: {
        key: 'system:adminBootstrap:completed',
        value: {
          completedAt: new Date().toISOString(),
          userId: user.id,
          email: user.email,
        },
      },
    });

    await this.prisma.automationAuditLog.create({
      data: {
        userId: user.id,
        action: 'ops.bootstrap_admin',
        before: { role: existing.role },
        after: { role: user.role, email: user.email, oneTime: true },
      },
    });

    return {
      ...user,
      bootstrapCompleted: true,
      message: 'Bootstrap complete. ADMIN_BOOTSTRAP_TOKEN no longer grants access.',
    };
  }

  private assertKnownQueue(queueName: string) {
    if (!(ALL_QUEUE_NAMES as readonly string[]).includes(queueName)) {
      throw new BadRequestException(`Unknown queue: ${queueName}`);
    }
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up' as const };
    } catch (error) {
      return { status: 'down' as const, error: (error as Error).message };
    }
  }

  private async checkRedis() {
    try {
      const queue = this.queues.getQueue(QUEUE_NAMES.STORY_GENERATION);
      const counts = await queue.getJobCounts('waiting', 'active');
      return { status: 'up' as const, waiting: counts.waiting, active: counts.active };
    } catch (error) {
      return { status: 'down' as const, error: (error as Error).message };
    }
  }

  private async checkMinio() {
    try {
      await this.storage.ping();
      return { status: 'up' as const };
    } catch (error) {
      return { status: 'down' as const, error: (error as Error).message };
    }
  }

  private async checkWorker() {
    const port = this.config.get<number>('ops.workerHealthPort', 3101);
    const host = this.config.get<string>('ops.workerHealthHost', 'worker');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { status: 'down' as const, error: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as Record<string, unknown>;
      return { status: 'up' as const, details: body };
    } catch (error) {
      return { status: 'down' as const, error: (error as Error).message };
    }
  }

  private getDiskUsage() {
    try {
      const stat = os.platform() === 'darwin' ? null : null;
      void stat;
      // Use df via sync-less approach — report tmpdir free space approximation
      const tmp = os.tmpdir();
      return {
        path: tmp,
        // detailed df is gathered by monitoring cron via shell when available
        usedPercent: 0,
        note: 'Detailed disk metrics collected by ops monitor cron on Linux hosts',
      };
    } catch {
      return { usedPercent: 0 };
    }
  }

  private getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      totalBytes: total,
      freeBytes: free,
      usedBytes: used,
      usedPercent: Number(((used / total) * 100).toFixed(1)),
      processRssBytes: process.memoryUsage().rss,
      processHeapUsedBytes: process.memoryUsage().heapUsed,
    };
  }

  private getProviderConnectivity() {
    const flag = (key: string, mockKey: string, altKeys: string[] = []) => {
      const mock = this.config.get<string>(mockKey, 'false') === 'true';
      const configured =
        Boolean(this.config.get<string>(key)) ||
        altKeys.some((k) => Boolean(this.config.get<string>(k)));
      return { configured, mock, status: mock ? 'mock' : configured ? 'configured' : 'missing' };
    };
    return {
      gemini: flag('integrations.geminiApiKey', 'integrations.geminiUseMock'),
      fal: flag('integrations.falApiKey', 'integrations.falUseMock'),
      kling: flag('integrations.klingApiKey', 'integrations.klingUseMock'),
      facebook: flag('integrations.facebookAppId', 'integrations.facebookUseMock', [
        'integrations.facebookPageAccessToken',
      ]),
      instagram: flag('integrations.instagramAppId', 'integrations.instagramUseMock', [
        'integrations.facebookPageAccessToken',
        'integrations.instagramAccountId',
      ]),
      tiktok: flag('integrations.tiktokClientKey', 'integrations.tiktokUseMock'),
      youtube: flag('integrations.youtubeClientId', 'integrations.youtubeUseMock'),
    };
  }

  assertReadyOrThrow(components: { database: { status: string }; redis: { status: string } }) {
    if (components.database.status !== 'up' || components.redis.status !== 'up') {
      throw new ServiceUnavailableException('Dependencies not ready');
    }
  }
}
