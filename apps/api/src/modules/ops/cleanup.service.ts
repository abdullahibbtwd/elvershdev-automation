import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ListObjectsV2Command,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Safe cleanup of temporary render files and unreferenced tmp/ MinIO objects.
 * Never deletes original assets, completed videos, or objects referenced by active records.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly locks: DistributedLockService,
  ) {
    const endpoint = this.config.get<string>('minio.endpoint', 'http://localhost:9000');
    this.bucket = this.config.get<string>('minio.bucket', 'ai-video');
    this.s3 = new S3Client({
      endpoint,
      region: this.config.get<string>('minio.region', 'us-east-1'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>('minio.accessKey', 'minioadmin'),
        secretAccessKey: this.config.get<string>('minio.secretKey', 'minioadmin'),
      },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledCleanup() {
    if (!shouldRunSchedulers()) return;
    if (process.env.TEMP_CLEANUP_DISABLED === 'true') return;
    const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 300);
    await this.locks.withLock('cron:cleanup', ttl, () => this.cleanupTemporaryArtifacts());
  }

  async cleanupTemporaryArtifacts() {
    const maxAgeHours = this.config.get<number>('ops.tempCleanupMaxAgeHours', 24);
    const cutoff = Date.now() - maxAgeHours * 3600_000;

    const local = await this.cleanupLocalTemp(cutoff);
    const remote = await this.cleanupOrphanTempObjects(cutoff);
    const oauth = await this.cleanupExpiredOauthStates();
    const sessions = await this.cleanupExpiredSessions();

    this.logger.log({ local, remote, oauth, sessions }, 'Cleanup completed');
    return { local, remote, oauth, sessions };
  }

  private async cleanupLocalTemp(cutoffMs: number) {
    const dir = os.tmpdir();
    let removed = 0;
    let skipped = 0;
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        if (
          !name.startsWith('render-') &&
          !name.startsWith('video-render-') &&
          !name.startsWith('social-publish-')
        ) {
          continue;
        }
        const full = path.join(dir, name);
        try {
          const stat = await fs.stat(full);
          if (stat.mtimeMs > cutoffMs) {
            skipped += 1;
            continue;
          }
          await fs.rm(full, { recursive: true, force: true });
          removed += 1;
        } catch {
          skipped += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`Local temp cleanup failed: ${(error as Error).message}`);
    }
    return { removed, skipped };
  }

  private async cleanupOrphanTempObjects(cutoffMs: number) {
    let removed = 0;
    let skipped = 0;
    let continuationToken: string | undefined;

    // Collect referenced storage keys that must never be deleted
    const protectedKeys = new Set<string>();
    const media = await this.prisma.mediaAsset.findMany({
      select: { storageKey: true },
      take: 50_000,
    });
    for (const m of media) {
      if (m.storageKey) protectedKeys.add(m.storageKey);
    }
    const renders = await this.prisma.videoRender.findMany({
      where: { outputMediaAssetId: { not: null } },
      select: { outputMediaAsset: { select: { storageKey: true } } },
      take: 20_000,
    });
    for (const r of renders) {
      if (r.outputMediaAsset?.storageKey) protectedKeys.add(r.outputMediaAsset.storageKey);
    }

    do {
      const listed = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'tmp/',
          ContinuationToken: continuationToken,
          MaxKeys: 200,
        }),
      );
      for (const obj of listed.Contents ?? []) {
        if (!obj.Key || !obj.LastModified) {
          skipped += 1;
          continue;
        }
        if (protectedKeys.has(obj.Key)) {
          skipped += 1;
          continue;
        }
        if (obj.LastModified.getTime() > cutoffMs) {
          skipped += 1;
          continue;
        }
        // Only delete under tmp/ prefix
        if (!obj.Key.startsWith('tmp/')) {
          skipped += 1;
          continue;
        }
        try {
          await this.s3.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
          );
          removed += 1;
        } catch {
          skipped += 1;
        }
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return { removed, skipped };
  }

  private async cleanupExpiredOauthStates() {
    const result = await this.prisma.oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return { removed: result.count };
  }

  private async cleanupExpiredSessions() {
    const result = await this.prisma.refreshSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { not: null, lt: new Date(Date.now() - 7 * 86400_000) } },
        ],
      },
    });
    return { removed: result.count };
  }
}
