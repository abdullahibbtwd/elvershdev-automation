import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EpisodeVideoClipStatus,
  MediaType,
  Prisma,
  SeriesEpisodeStatus,
  StoryStatus,
  VideoRenderStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  bullMqJobId,
  type SeriesClipAssemblyPayload,
} from '@ai-video/shared';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class ClipAssemblyService {
  private readonly logger = new Logger(ClipAssemblyService.name);
  private readonly ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
  private readonly ffprobePath = process.env.FFPROBE_PATH ?? 'ffprobe';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
  ) {}

  async getAssemblyStatus(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    const clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId, userId },
      orderBy: { clipIndex: 'asc' },
      select: {
        id: true,
        clipIndex: true,
        status: true,
        durationSeconds: true,
        videoMediaAssetId: true,
      },
    });
    const completed = clips.filter(
      (c) => c.status === EpisodeVideoClipStatus.COMPLETED && c.videoMediaAssetId,
    );
    const render = episode.videoRenderId
      ? await this.prisma.videoRender.findUnique({
          where: { id: episode.videoRenderId },
          include: {
            outputMediaAsset: {
              select: { id: true, storageKey: true, mimeType: true, fileSize: true },
            },
          },
        })
      : null;

    return {
      episodeId,
      clipCount: clips.length,
      completedClipCount: completed.length,
      readyToAssemble:
        clips.length > 0 && completed.length === clips.length && clips.length > 0,
      missingClips: clips
        .filter(
          (c) =>
            c.status !== EpisodeVideoClipStatus.COMPLETED || !c.videoMediaAssetId,
        )
        .map((c) => ({ id: c.id, clipIndex: c.clipIndex, status: c.status })),
      videoRenderId: episode.videoRenderId,
      actualDurationSeconds: episode.actualDurationSeconds,
      render: render
        ? {
            id: render.id,
            status: render.status,
            duration: render.duration,
            outputMediaAssetId: render.outputMediaAssetId,
            outputMediaAsset: render.outputMediaAsset,
            renderSettings: render.renderSettings,
          }
        : null,
    };
  }

  async enqueueAssemble(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: {
      force?: boolean;
      async?: boolean;
      backgroundMusicAssetId?: string;
      musicGainDb?: number;
    },
  ) {
    await this.requireEpisode(userId, seriesId, episodeId);
    const readiness = await this.getAssemblyStatus(userId, seriesId, episodeId);
    if (!readiness.readyToAssemble) {
      throw new BadRequestException(
        `Cannot assemble: ${readiness.completedClipCount}/${readiness.clipCount} clips completed. Generate all Grok Lite clips first.`,
      );
    }

    const assembledClipIds = Array.isArray(
      (readiness.render?.renderSettings as { clipIds?: unknown } | null | undefined)?.clipIds,
    )
      ? (
          (readiness.render!.renderSettings as { clipIds: string[] }).clipIds
        ).slice().sort()
      : [];
    const currentClipIds = (
      await this.prisma.episodeVideoClip.findMany({
        where: {
          episodeId,
          status: EpisodeVideoClipStatus.COMPLETED,
          videoMediaAssetId: { not: null },
        },
        select: { id: true },
        orderBy: { clipIndex: 'asc' },
      })
    )
      .map((c) => c.id)
      .slice()
      .sort();
    const clipsChanged =
      assembledClipIds.length > 0 &&
      (assembledClipIds.length !== currentClipIds.length ||
        assembledClipIds.some((id, i) => id !== currentClipIds[i]));

    if (
      readiness.render?.status === VideoRenderStatus.COMPLETED &&
      readiness.render.outputMediaAssetId &&
      !options?.force &&
      !clipsChanged
    ) {
      return {
        queued: false,
        skipped: true,
        videoRenderId: readiness.videoRenderId,
        reason: 'already_assembled',
      };
    }

    if (options?.async === false) {
      const result = await this.assemble(userId, seriesId, episodeId, options);
      return { queued: false, processed: true, result };
    }

    const jobId = bullMqJobId('series-assemble', episodeId, Date.now());
    const payload: SeriesClipAssemblyPayload = {
      userId,
      seriesId,
      episodeId,
      force: options?.force,
      backgroundMusicAssetId: options?.backgroundMusicAssetId,
      musicGainDb: options?.musicGainDb,
    };
    await this.queues.getQueue(QUEUE_NAMES.SERIES_CLIP_ASSEMBLY).add('assemble', payload, {
      jobId,
    });
    return { queued: true, jobId };
  }

  /**
   * Concat COMPLETED EpisodeVideoClips (copy, then re-encode fallback),
   * optionally bed background music, create VideoRender + MediaAsset, link episode.
   * Does NOT require narration scripts (Phase 5 narration-gate bypass for Grok path).
   */
  async assemble(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: {
      force?: boolean;
      backgroundMusicAssetId?: string;
      musicGainDb?: number;
    },
  ) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      include: {
        audioMixes: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    if (
      episode.videoRenderId &&
      !options?.force
    ) {
      const existing = await this.prisma.videoRender.findUnique({
        where: { id: episode.videoRenderId },
      });
      if (existing?.status === VideoRenderStatus.COMPLETED && existing.outputMediaAssetId) {
        return {
          skipped: true,
          videoRenderId: existing.id,
          outputMediaAssetId: existing.outputMediaAssetId,
          durationSeconds: existing.duration,
        };
      }
    }

    const clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId, userId },
      orderBy: { clipIndex: 'asc' },
      include: { videoMediaAsset: true },
    });
    if (clips.length === 0) {
      throw new BadRequestException('No clips to assemble');
    }
    const incomplete = clips.filter(
      (c) => c.status !== EpisodeVideoClipStatus.COMPLETED || !c.videoMediaAsset,
    );
    if (incomplete.length > 0) {
      throw new BadRequestException(
        `${incomplete.length} clip(s) are not COMPLETED with video assets`,
      );
    }

    let musicAssetId = options?.backgroundMusicAssetId ?? null;
    if (musicAssetId) {
      const music = await this.prisma.mediaAsset.findFirst({
        where: { id: musicAssetId, userId },
      });
      if (!music) {
        throw new BadRequestException('backgroundMusicAssetId not found for this user');
      }
    }

    const musicGainDb =
      options?.musicGainDb ??
      (episode.audioMixes[0]?.musicGainDb != null
        ? Number(episode.audioMixes[0].musicGainDb)
        : -12);

    const workDir = await mkdtemp(join(tmpdir(), 'series-assemble-'));
    const startedAt = Date.now();

    try {
      const clipPaths: string[] = [];
      for (const clip of clips) {
        const asset = clip.videoMediaAsset!;
        const stream = await this.storage.getObjectStream(asset.storageKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream.body) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        const mocked = (clip.metadata as Record<string, unknown> | null)?.mocked === true;
        // ~3KB createMockMp4Buffer placeholders assemble into a blank ~6s file.
        if (!mocked && bytes.byteLength < 50_000) {
          throw new BadRequestException(
            `Clip ${clip.clipIndex + 1} looks like a mock/empty file (${bytes.byteLength} bytes). Regenerate Grok clips with a real XAI_API_KEY (Use mock AI off).`,
          );
        }
        const path = join(
          workDir,
          `clip-${String(clip.clipIndex + 1).padStart(3, '0')}.mp4`,
        );
        await writeFile(path, bytes);
        clipPaths.push(path);
      }

      const listFile = join(workDir, 'concat.txt');
      await writeFile(
        listFile,
        clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      );

      const concatPath = join(workDir, 'concat.mp4');
      // Always re-encode: Grok clips often differ in codec/timebase; `-c copy` can
      // "succeed" with a truncated/broken file (e.g. ~6s from 31s of clips).
      const reencode = this.runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-vf',
        // Crop-to-fill 9:16 — never letterbox landscape clips into a skinny pillar.
        'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        concatPath,
      ]);
      if (reencode.status !== 0) {
        throw new Error(
          `FFmpeg assembly failed: ${reencode.stderr || 'unknown'}`.slice(0, 4000),
        );
      }

      let finalPath = concatPath;
      if (musicAssetId) {
        const musicStream = await this.storage.getObjectStream(
          (
            await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: musicAssetId } })
          ).storageKey,
        );
        const musicChunks: Buffer[] = [];
        for await (const chunk of musicStream.body) {
          musicChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const musicPath = join(workDir, 'music-bed');
        await writeFile(musicPath, Buffer.concat(musicChunks));
        const mixedPath = join(workDir, 'mixed.mp4');
        const vol = Math.pow(10, musicGainDb / 20);
        const mix = this.runFfmpeg([
          '-y',
          '-i',
          concatPath,
          '-stream_loop',
          '-1',
          '-i',
          musicPath,
          '-filter_complex',
          `[1:a]volume=${vol.toFixed(4)}[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          '-map',
          '0:v',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          mixedPath,
        ]);
        if (mix.status !== 0) {
          // Fallback: re-encode video+audio together
          const mix2 = this.runFfmpeg([
            '-y',
            '-i',
            concatPath,
            '-stream_loop',
            '-1',
            '-i',
            musicPath,
            '-filter_complex',
            `[1:a]volume=${vol.toFixed(4)}[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
            '-map',
            '0:v',
            '-map',
            '[aout]',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-shortest',
            '-movflags',
            '+faststart',
            mixedPath,
          ]);
          if (mix2.status !== 0) {
            this.logger.warn(
              `Music mix failed episode=${episodeId}; shipping concat without music. ${mix.stderr.slice(0, 300)}`,
            );
          } else {
            finalPath = mixedPath;
          }
        } else {
          finalPath = mixedPath;
        }
      }

      const probed = this.probeDuration(finalPath);
      const expectedFromClips = clips.reduce(
        (sum, c) => sum + (Number(c.durationSeconds) || 0),
        0,
      );
      // Always prefer probed file duration — never claim 31s when the mp4 is actually ~6s.
      const durationSeconds = probed > 0 ? probed : expectedFromClips;
      if (probed > 0 && expectedFromClips > 0 && Math.abs(probed - expectedFromClips) > 5) {
        this.logger.warn(
          `Assembly duration mismatch episode=${episodeId} probed=${probed}s clipSum=${expectedFromClips}s using=${durationSeconds}s`,
        );
      }
      if (expectedFromClips >= 20 && probed > 0 && probed < expectedFromClips * 0.4) {
        throw new Error(
          `Assembled video is only ${probed.toFixed(1)}s but clips plan ${expectedFromClips}s — likely mock/corrupt sources. Regenerate real Grok clips.`,
        );
      }
      const finalBytes = await readFile(finalPath);
      const storageKey = `series/${seriesId}/episodes/${episodeId}/assembled/v1.mp4`;
      await this.storage.uploadObject(storageKey, finalBytes, 'video/mp4');

      const outputAsset = await this.prisma.mediaAsset.create({
        data: {
          userId,
          type: MediaType.VIDEO,
          storageKey,
          originalName: `episode-${episode.episodeNumber}-assembled.mp4`,
          mimeType: 'video/mp4',
          fileSize: BigInt(finalBytes.byteLength),
          metadata: {
            seriesId,
            episodeId,
            source: 'clip_assembly',
            dialogueDriven: true,
            clipCount: clips.length,
            backgroundMusicAssetId: musicAssetId,
            musicGainDb,
          } as Prisma.InputJsonValue,
        },
      });

      let storyId = episode.storyId;
      if (!storyId) {
        const story = await this.prisma.story.create({
          data: {
            userId,
            title: episode.title,
            content: episode.script || episode.title,
            status: StoryStatus.READY,
            language: 'en',
            targetDurationSeconds: Math.max(
              1,
              Math.round(durationSeconds || episode.targetDurationSeconds),
            ),
          },
        });
        storyId = story.id;
      }

      const render = await this.prisma.videoRender.create({
        data: {
          userId,
          storyId,
          status: VideoRenderStatus.COMPLETED,
          renderType: 'clip_assembly',
          aspectRatio: '9:16',
          width: 1080,
          height: 1920,
          frameRate: 30,
          subtitleEnabled: false,
          subtitleBurnedIn: false,
          backgroundMusicAssetId: musicAssetId,
          outputMediaAssetId: outputAsset.id,
          duration: durationSeconds,
          fileSize: BigInt(finalBytes.byteLength),
          progress: 100,
          totalSceneCount: clips.length,
          completedSceneCount: clips.length,
          processingTimeMs: Date.now() - startedAt,
          startedAt: new Date(startedAt),
          completedAt: new Date(),
          renderSettings: {
            source: 'clip_assembly',
            dialogueDriven: true,
            narrationGateBypassed: true,
            clipIds: clips.map((c) => c.id),
            musicGainDb,
          } as Prisma.InputJsonValue,
          timeline: {
            strategy: 'clip_concat',
            clips: clips.map((c) => ({
              clipId: c.id,
              clipIndex: c.clipIndex,
              durationSeconds: c.durationSeconds,
            })),
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          storyId,
          videoRenderId: render.id,
          actualDurationSeconds: durationSeconds,
          status: SeriesEpisodeStatus.RENDERED,
          lastError: null,
          metadata: {
            ...((episode.metadata as Record<string, unknown> | null) ?? {}),
            assembly: {
              assembledAt: new Date().toISOString(),
              videoRenderId: render.id,
              outputMediaAssetId: outputAsset.id,
              clipCount: clips.length,
              durationSeconds,
              backgroundMusicAssetId: musicAssetId,
            },
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.seriesAuditLog.create({
        data: {
          userId,
          action: 'series.episode.assemble',
          entityType: 'SeriesEpisode',
          entityId: episodeId,
          after: {
            videoRenderId: render.id,
            outputMediaAssetId: outputAsset.id,
            durationSeconds,
            clipCount: clips.length,
          },
        },
      });

      this.logger.log(
        `Assembled episode=${episodeId} clips=${clips.length} duration=${durationSeconds}s render=${render.id}`,
      );

      return {
        videoRenderId: render.id,
        outputMediaAssetId: outputAsset.id,
        storageKey,
        durationSeconds,
        clipCount: clips.length,
        processingTimeMs: Date.now() - startedAt,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async handleQueueJob(payload: SeriesClipAssemblyPayload) {
    return this.assemble(payload.userId, payload.seriesId, payload.episodeId, {
      force: payload.force,
      backgroundMusicAssetId: payload.backgroundMusicAssetId,
      musicGainDb: payload.musicGainDb,
    });
  }

  private runFfmpeg(args: string[]): { status: number | null; stderr: string; stdout: string } {
    const result = spawnSync(this.ffmpegPath, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      status: result.status,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  }

  private probeDuration(path: string): number {
    const probe = spawnSync(
      this.ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { encoding: 'utf8' },
    );
    const value = Number.parseFloat((probe.stdout ?? '').trim());
    return Number.isFinite(value) ? value : 0;
  }

  private async requireEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      select: {
        id: true,
        videoRenderId: true,
        actualDurationSeconds: true,
        episodeNumber: true,
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }
}
