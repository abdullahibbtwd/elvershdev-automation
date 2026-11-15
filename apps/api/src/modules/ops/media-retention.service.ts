import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, PublishStatus, VideoRenderStatus } from '@prisma/client';
import { shouldRunSchedulers } from '../../common/process-role';
import { DistributedLockService } from '../../common/redis/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/**
 * After a render is successfully published:
 * - 24h: delete intermediate images / motion clips / narration audio / subtitle files
 *         (and clear long prompt text). Keep the final MP4.
 * - 7d:  delete the final MP4 as well.
 */
@Injectable()
export class MediaRetentionService {
  private readonly logger = new Logger(MediaRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly locks: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRetention() {
    if (!shouldRunSchedulers()) return;
    if (process.env.MEDIA_RETENTION_DISABLED === 'true') return;
    const ttl = this.config.get<number>('ops.schedulerLockTtlSeconds', 300);
    await this.locks.withLock('cron:media-retention', Math.max(ttl, 300), () =>
      this.runRetentionPass(),
    );
  }

  async runRetentionPass() {
    const intermediateHours = this.config.get<number>(
      'ops.mediaIntermediateRetentionHours',
      24,
    );
    const finalDays = this.config.get<number>('ops.mediaFinalRetentionDays', 7);

    const intermediates = await this.purgeDueIntermediates(intermediateHours);
    const finals = await this.purgeDueFinalVideos(finalDays);
    this.logger.log({ intermediates, finals }, 'Media retention pass completed');
    return { intermediates, finals };
  }

  private async purgeDueIntermediates(retentionHours: number) {
    const cutoff = new Date(Date.now() - retentionHours * 3600_000);
    const candidates = await this.prisma.videoRender.findMany({
      where: {
        status: VideoRenderStatus.COMPLETED,
        intermediatesPurgedAt: null,
        publishRecords: {
          some: {
            status: PublishStatus.PUBLISHED,
            publishedAt: { lte: cutoff },
          },
        },
      },
      select: {
        id: true,
        storyId: true,
        outputMediaAssetId: true,
        subtitleMediaAssetId: true,
        backgroundMusicAssetId: true,
      },
      take: 40,
      orderBy: { completedAt: 'asc' },
    });

    let purged = 0;
    let failed = 0;
    for (const render of candidates) {
      try {
        await this.purgeIntermediatesForRender(render);
        purged += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Intermediate purge failed for render ${render.id}: ${(error as Error).message}`,
        );
      }
    }
    return { candidates: candidates.length, purged, failed };
  }

  private async purgeDueFinalVideos(retentionDays: number) {
    const cutoff = new Date(Date.now() - retentionDays * 86400_000);
    const candidates = await this.prisma.videoRender.findMany({
      where: {
        outputPurgedAt: null,
        outputMediaAssetId: { not: null },
        publishRecords: {
          some: {
            status: PublishStatus.PUBLISHED,
            publishedAt: { lte: cutoff },
          },
        },
      },
      select: {
        id: true,
        outputMediaAssetId: true,
      },
      take: 40,
      orderBy: { completedAt: 'asc' },
    });

    let purged = 0;
    let failed = 0;
    for (const render of candidates) {
      try {
        await this.purgeFinalOutput(render.id, render.outputMediaAssetId);
        purged += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Final video purge failed for render ${render.id}: ${(error as Error).message}`,
        );
      }
    }
    return { candidates: candidates.length, purged, failed };
  }

  private async purgeIntermediatesForRender(render: {
    id: string;
    storyId: string;
    outputMediaAssetId: string | null;
    subtitleMediaAssetId: string | null;
    backgroundMusicAssetId: string | null;
  }) {
    const keep = new Set(
      [render.outputMediaAssetId, render.backgroundMusicAssetId].filter(
        (id): id is string => Boolean(id),
      ),
    );

    const story = await this.prisma.story.findUniqueOrThrow({
      where: { id: render.storyId },
      include: {
        scenes: {
          include: {
            visuals: { select: { generatedImageMediaId: true } },
            motionGenerations: {
              select: { outputMediaAssetId: true, sourceMediaAssetId: true },
            },
          },
        },
        characters: {
          include: {
            visualReferences: { select: { mediaAssetId: true } },
          },
        },
        narrationScripts: {
          include: {
            scenes: {
              include: {
                audioGenerations: { select: { audioMediaAssetId: true } },
              },
            },
            audioGenerations: { select: { audioMediaAssetId: true } },
          },
        },
      },
    });

    const assetIds = new Set<string>();
    const storageKeys = new Set<string>();

    for (const scene of story.scenes) {
      for (const visual of scene.visuals) {
        if (visual.generatedImageMediaId && !keep.has(visual.generatedImageMediaId)) {
          assetIds.add(visual.generatedImageMediaId);
        }
      }
      for (const motion of scene.motionGenerations) {
        if (motion.outputMediaAssetId && !keep.has(motion.outputMediaAssetId)) {
          assetIds.add(motion.outputMediaAssetId);
        }
        if (motion.sourceMediaAssetId && !keep.has(motion.sourceMediaAssetId)) {
          assetIds.add(motion.sourceMediaAssetId);
        }
      }
    }

    for (const character of story.characters) {
      for (const ref of character.visualReferences) {
        if (ref.mediaAssetId && !keep.has(ref.mediaAssetId)) {
          assetIds.add(ref.mediaAssetId);
        }
      }
    }

    for (const script of story.narrationScripts) {
      for (const audio of script.audioGenerations) {
        if (audio.audioMediaAssetId && !keep.has(audio.audioMediaAssetId)) {
          assetIds.add(audio.audioMediaAssetId);
        }
      }
      for (const sceneNarration of script.scenes) {
        for (const audio of sceneNarration.audioGenerations) {
          if (audio.audioMediaAssetId && !keep.has(audio.audioMediaAssetId)) {
            assetIds.add(audio.audioMediaAssetId);
          }
        }
      }
    }

    if (render.subtitleMediaAssetId && !keep.has(render.subtitleMediaAssetId)) {
      assetIds.add(render.subtitleMediaAssetId);
    }

    const renderScenes = await this.prisma.videoRenderScene.findMany({
      where: { videoRenderId: render.id, segmentStorageKey: { not: null } },
      select: { segmentStorageKey: true },
    });
    for (const scene of renderScenes) {
      if (scene.segmentStorageKey) storageKeys.add(scene.segmentStorageKey);
    }

    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: [...assetIds] } },
      select: { id: true, storageKey: true },
    });
    for (const asset of assets) {
      if (asset.storageKey) storageKeys.add(asset.storageKey);
    }

    const ids = [...assetIds];

    await this.prisma.$transaction(async (tx) => {
      // Motion.sourceMediaAsset is Restrict — delete motion rows before media.
      await tx.motionGeneration.deleteMany({ where: { storyId: render.storyId } });

      await tx.characterVisualReference.deleteMany({
        where: { mediaAssetId: { in: ids } },
      });

      await tx.sceneVisual.updateMany({
        where: { scene: { storyId: render.storyId } },
        data: {
          generatedImageMediaId: null,
          visualPrompt: '[purged]',
          negativePrompt: null,
          structuredBrief: Prisma.DbNull,
        },
      });

      await tx.audioGeneration.updateMany({
        where: { audioMediaAssetId: { in: ids } },
        data: { audioMediaAssetId: null },
      });

      await tx.videoRender.update({
        where: { id: render.id },
        data: {
          subtitleMediaAssetId: null,
          intermediatesPurgedAt: new Date(),
        },
      });

      await tx.videoRenderScene.updateMany({
        where: { videoRenderId: render.id },
        data: { segmentStorageKey: null },
      });

      if (ids.length) {
        await tx.mediaAsset.deleteMany({ where: { id: { in: ids } } });
      }
    });

    for (const key of storageKeys) {
      try {
        await this.storage.deleteObject(key);
      } catch (error) {
        this.logger.warn(`Failed to delete MinIO key ${key}: ${(error as Error).message}`);
      }
    }
  }

  private async purgeFinalOutput(renderId: string, outputMediaAssetId: string | null) {
    if (!outputMediaAssetId) {
      await this.prisma.videoRender.update({
        where: { id: renderId },
        data: { outputPurgedAt: new Date() },
      });
      return;
    }

    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: outputMediaAssetId },
      select: { id: true, storageKey: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.videoRender.update({
        where: { id: renderId },
        data: {
          outputMediaAssetId: null,
          outputPurgedAt: new Date(),
          intermediatesPurgedAt: new Date(),
        },
      });
      if (asset) {
        await tx.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      }
    });

    if (asset?.storageKey) {
      try {
        await this.storage.deleteObject(asset.storageKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete final MinIO key ${asset.storageKey}: ${(error as Error).message}`,
        );
      }
    }
  }
}
