import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EpisodeVideoClipStatus, MediaType, Prisma } from '@prisma/client';
import {
  QUEUE_NAMES,
  assertXaiLiteModel,
  bullMqJobId,
  isXaiVideoProviderEnabled,
  normalizeXaiAspectRatio,
  normalizeXaiVideoDuration,
  normalizeXaiVideoResolution,
  type SeriesClipGenerationMode,
  type SeriesClipGenerationPayload,
} from '@ai-video/shared';
import { XaiVideoProvider } from '../../integrations/providers/xai-video.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { CharacterDirectorService } from './character-director.service';

const TERMINAL_STATUSES: EpisodeVideoClipStatus[] = [
  EpisodeVideoClipStatus.COMPLETED,
  EpisodeVideoClipStatus.CANCELLED,
];

const REGENERABLE_STATUSES: EpisodeVideoClipStatus[] = [
  EpisodeVideoClipStatus.PLANNED,
  EpisodeVideoClipStatus.FAILED,
  EpisodeVideoClipStatus.CANCELLED,
];

@Injectable()
export class ClipGenerationService {
  private readonly logger = new Logger(ClipGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly xai: XaiVideoProvider,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly characters: CharacterDirectorService,
  ) {}

  /**
   * Best-effort: mint approved cartoon reference stills before Grok packs.
   * Fal auth/billing failures must NOT block clip generation — auto mode falls
   * back to text-to-video with identity text locks when refs are missing.
   */
  async ensureCharacterReferences(userId: string, seriesId: string) {
    try {
      const results = await this.characters.generateReferencesForSeries(userId, seriesId);
      const created = results.filter((r) => !r.skipped && !r.error).length;
      const failed = results.filter((r) => r.error).length;
      if (created > 0) {
        this.logger.log(
          `Minted ${created} character reference(s) before clip generation series=${seriesId}`,
        );
      }
      if (failed > 0) {
        this.logger.warn(
          `Character reference mint incomplete series=${seriesId}: ${failed} failed (Grok will use text identity / T2V until refs exist)`,
        );
      }
      return results;
    } catch (error) {
      this.logger.warn(
        `Character reference mint skipped series=${seriesId}: ${(error as Error).message}. Continuing clip generation without I2V refs.`,
      );
      return [];
    }
  }

  async getClipStatus(userId: string, seriesId: string, episodeId: string) {
    await this.requireEpisode(userId, seriesId, episodeId);
    const clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId, userId },
      orderBy: { clipIndex: 'asc' },
      include: {
        videoMediaAsset: {
          select: { id: true, storageKey: true, mimeType: true, fileSize: true },
        },
      },
    });
    const counts = clips.reduce(
      (acc, clip) => {
        acc[clip.status] = (acc[clip.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return {
      episodeId,
      clipCount: clips.length,
      completedCount: counts.COMPLETED ?? 0,
      failedCount: counts.FAILED ?? 0,
      inFlightCount:
        (counts.QUEUED ?? 0) +
        (counts.SUBMITTED ?? 0) +
        (counts.GENERATING ?? 0) +
        (counts.DOWNLOADING ?? 0) +
        (counts.RETRYING ?? 0),
      statusCounts: counts,
      estimatedCostUsd: Number(
        clips.reduce((sum, c) => sum + Number(c.estimatedCostUsd ?? 0), 0).toFixed(6),
      ),
      actualCostUsd: Number(
        clips.reduce((sum, c) => sum + Number(c.actualCostUsd ?? 0), 0).toFixed(6),
      ),
      clips,
    };
  }

  /**
   * Queue generation for all regenerable clips (or force every non-terminal).
   */
  async generateEpisodeClips(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: {
      useMockAi?: boolean;
      force?: boolean;
      async?: boolean;
      mode?: SeriesClipGenerationMode;
    },
  ) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    const clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId, userId },
      orderBy: { clipIndex: 'asc' },
    });
    if (clips.length === 0) {
      throw new BadRequestException(
        'No clip plan found. Build a clip plan before generating Grok Lite videos.',
      );
    }

    await this.ensureCharacterReferences(userId, seriesId);
    this.assertXaiReady(options?.useMockAi === true);

    const targets = clips.filter((clip) => {
      if (TERMINAL_STATUSES.includes(clip.status) && clip.status === EpisodeVideoClipStatus.COMPLETED) {
        return options?.force === true;
      }
      if (TERMINAL_STATUSES.includes(clip.status) && clip.status === EpisodeVideoClipStatus.CANCELLED) {
        return true;
      }
      return REGENERABLE_STATUSES.includes(clip.status) || options?.force === true;
    });

    if (targets.length === 0) {
      return {
        queued: false,
        message: 'No clips need generation (all completed). Pass force=true to regenerate.',
        clipCount: clips.length,
        queuedClipIds: [] as string[],
      };
    }

    await this.assertBudgetAllows(
      userId,
      targets.reduce((sum, c) => sum + c.durationSeconds, 0),
    );

    if (options?.async === false) {
      const results = [];
      for (const clip of targets) {
        results.push(
          await this.processClip(userId, seriesId, episodeId, clip.id, {
            useMockAi: options?.useMockAi,
            force: options?.force,
            mode: options?.mode ?? 'auto',
          }),
        );
      }
      return {
        queued: false,
        processed: true,
        clipCount: targets.length,
        results,
      };
    }

    const queuedClipIds: string[] = [];
    for (const clip of targets) {
      await this.prisma.episodeVideoClip.update({
        where: { id: clip.id },
        data: {
          status: EpisodeVideoClipStatus.QUEUED,
          errorMessage: null,
          ...(options?.force
            ? {
                providerRequestId: null,
                videoMediaAssetId: null,
                actualCostUsd: null,
              }
            : {}),
        },
      });
      const jobId = bullMqJobId('series-clip', clip.id, Date.now());
      const payload: SeriesClipGenerationPayload = {
        userId,
        seriesId,
        episodeId: episode.id,
        clipId: clip.id,
        action: 'process_clip',
        mode: options?.mode ?? 'auto',
        useMockAi: options?.useMockAi,
        force: options?.force,
      };
      await this.queues.getQueue(QUEUE_NAMES.SERIES_CLIP_GENERATION).add('process_clip', payload, {
        jobId,
      });
      queuedClipIds.push(clip.id);
    }

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.episode.clips.generate',
        entityType: 'SeriesEpisode',
        entityId: episodeId,
        after: {
          queuedCount: queuedClipIds.length,
          force: options?.force === true,
          useMockAi: options?.useMockAi === true,
          mode: options?.mode ?? 'auto',
        },
      },
    });

    return {
      queued: true,
      clipCount: queuedClipIds.length,
      queuedClipIds,
    };
  }

  async generateOneClip(
    userId: string,
    seriesId: string,
    episodeId: string,
    clipId: string,
    options?: {
      useMockAi?: boolean;
      force?: boolean;
      async?: boolean;
      mode?: SeriesClipGenerationMode;
    },
  ) {
    await this.requireEpisode(userId, seriesId, episodeId);
    const clip = await this.prisma.episodeVideoClip.findFirst({
      where: { id: clipId, episodeId, userId },
    });
    if (!clip) throw new NotFoundException('Clip not found');

    this.assertXaiReady(options?.useMockAi === true);
    await this.assertBudgetAllows(userId, clip.durationSeconds);

    if (
      clip.status === EpisodeVideoClipStatus.COMPLETED &&
      clip.videoMediaAssetId &&
      !options?.force
    ) {
      return { queued: false, skipped: true, clipId, reason: 'already_completed' };
    }

    if (options?.async === false) {
      const result = await this.processClip(userId, seriesId, episodeId, clipId, options);
      return { queued: false, processed: true, result };
    }

    await this.prisma.episodeVideoClip.update({
      where: { id: clipId },
      data: {
        status: EpisodeVideoClipStatus.QUEUED,
        errorMessage: null,
        ...(options?.force
          ? {
              providerRequestId: null,
              videoMediaAssetId: null,
              actualCostUsd: null,
            }
          : {}),
      },
    });

    const jobId = bullMqJobId('series-clip', clipId, Date.now());
    const payload: SeriesClipGenerationPayload = {
      userId,
      seriesId,
      episodeId,
      clipId,
      action: 'process_clip',
      mode: options?.mode ?? 'auto',
      useMockAi: options?.useMockAi,
      force: options?.force,
    };
    await this.queues.getQueue(QUEUE_NAMES.SERIES_CLIP_GENERATION).add('process_clip', payload, {
      jobId,
    });

    return { queued: true, clipId, jobId };
  }

  async cancelEpisodeClips(userId: string, seriesId: string, episodeId: string) {
    await this.requireEpisode(userId, seriesId, episodeId);
    const result = await this.prisma.episodeVideoClip.updateMany({
      where: {
        episodeId,
        userId,
        status: {
          in: [
            EpisodeVideoClipStatus.QUEUED,
            EpisodeVideoClipStatus.SUBMITTED,
            EpisodeVideoClipStatus.GENERATING,
            EpisodeVideoClipStatus.RETRYING,
          ],
        },
      },
      data: {
        status: EpisodeVideoClipStatus.CANCELLED,
        errorMessage: 'Cancelled by user',
      },
    });
    return { cancelledCount: result.count };
  }

  /**
   * Submit → poll → download one clip via Grok Imagine Video 1.5 Lite.
   * Idempotent: resumes poll when providerRequestId already set.
   */
  async processClip(
    userId: string,
    seriesId: string,
    episodeId: string,
    clipId: string,
    options?: {
      useMockAi?: boolean;
      force?: boolean;
      mode?: SeriesClipGenerationMode;
    },
  ) {
    const clip = await this.prisma.episodeVideoClip.findFirst({
      where: { id: clipId, episodeId, userId },
      include: {
        episode: {
          include: {
            series: {
              include: {
                characters: {
                  include: {
                    referenceAssets: {
                      where: { isApproved: true },
                      orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
                      take: 1,
                      include: { mediaAsset: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!clip) throw new NotFoundException('Clip not found');
    if (clip.episode.seriesId !== seriesId) {
      throw new BadRequestException('Clip does not belong to this series');
    }

    // Only mint refs before a fresh submit — never block a resume/poll on fal balance.
    if (!clip.providerRequestId || options?.force) {
      await this.ensureCharacterReferences(userId, seriesId);
    }

    if (
      clip.status === EpisodeVideoClipStatus.COMPLETED &&
      clip.videoMediaAssetId &&
      !options?.force
    ) {
      return { clipId, status: 'COMPLETED', skipped: true };
    }

    if (clip.status === EpisodeVideoClipStatus.CANCELLED && !options?.force) {
      return { clipId, status: 'CANCELLED', skipped: true };
    }

    // Only mock when explicitly requested — never silent-fallback if XAI_API_KEY is missing.
    const useMock =
      options?.useMockAi === true ||
      this.config.get<string>('integrations.xaiVideoUseMock') === 'true' ||
      process.env.XAI_VIDEO_USE_MOCK === 'true';
    this.assertXaiReady(useMock);

    const model = assertXaiLiteModel(clip.providerModel || this.xai.getModel());
    const durationSeconds = normalizeXaiVideoDuration(clip.durationSeconds);
    const resolution = normalizeXaiVideoResolution(
      this.config.get<string>('integrations.xaiVideoResolution', '720p'),
    );
    const aspectRatio = normalizeXaiAspectRatio(
      ((clip.metadata as Record<string, unknown> | null)?.aspectRatio as string | undefined) ??
        '9:16',
    );

    let providerRequestId = clip.providerRequestId;
    let estimatedCostUsd = Number(clip.estimatedCostUsd ?? 0);

    try {
      if (!providerRequestId || options?.force) {
        const mode = await this.resolveMode(clip, options?.mode ?? 'auto');
        const submit = await this.submitWithOptionalMock(
          {
            mode,
            prompt: clip.prompt,
            durationSeconds,
            resolution,
            aspectRatio,
            model,
            externalTaskId: clip.id,
            imageUrl: mode === 'image_to_video' ? await this.resolveReferenceImageUrl(clip) : undefined,
          },
          useMock,
        );

        providerRequestId = submit.providerTaskId;
        estimatedCostUsd = submit.estimatedCostUsd;

        await this.prisma.episodeVideoClip.update({
          where: { id: clipId },
          data: {
            status: EpisodeVideoClipStatus.SUBMITTED,
            provider: 'xai',
            providerModel: model,
            providerRequestId,
            estimatedCostUsd: new Prisma.Decimal(estimatedCostUsd.toFixed(6)),
            errorMessage: null,
            metadata: {
              ...((clip.metadata as Record<string, unknown> | null) ?? {}),
              submitMode: mode,
              mocked: submit.mock === true,
              submittedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        await this.prisma.providerUsage.create({
          data: {
            userId,
            provider: 'xai',
            model,
            requestType:
              mode === 'image_to_video' ? 'image_to_video_submit' : 'text_to_video_submit',
            estimatedCost: estimatedCostUsd,
            metadata: {
              episodeId,
              seriesId,
              clipId,
              providerRequestId,
              durationSeconds,
              resolution,
              mocked: submit.mock === true,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await this.prisma.episodeVideoClip.update({
        where: { id: clipId },
        data: { status: EpisodeVideoClipStatus.GENERATING },
      });

      const poll = await this.pollUntilDone(providerRequestId!, useMock);
      if (poll.status === 'failed' || poll.status === 'cancelled') {
        throw new Error(poll.message || `xAI clip generation ${poll.status}`);
      }
      if (poll.status !== 'succeeded') {
        throw new Error(`xAI clip generation timed out (last status=${poll.status})`);
      }

      await this.prisma.episodeVideoClip.update({
        where: { id: clipId },
        data: { status: EpisodeVideoClipStatus.DOWNLOADING },
      });

      const retrieved = await this.xai.retrieveCompletedVideo(poll);
      const bytes = Buffer.from(retrieved.buffer);
      // Real Lite clips are multi‑MB; mock placeholders are ~3KB. Refuse silent mocks in live mode.
      if (!useMock && (poll.mock === true || bytes.byteLength < 50_000)) {
        throw new Error(
          `xAI returned a non-real clip payload (${bytes.byteLength} bytes, mock=${poll.mock === true}). Check XAI_API_KEY and retry.`,
        );
      }
      const storageKey = `series/${seriesId}/episodes/${episodeId}/clips/${clipId}.mp4`;
      await this.storage.uploadObject(
        storageKey,
        bytes,
        retrieved.mimeType || 'video/mp4',
      );

      const media = await this.prisma.mediaAsset.create({
        data: {
          userId,
          type: MediaType.VIDEO,
          storageKey,
          originalName: `clip-${clip.clipIndex + 1}.mp4`,
          mimeType: retrieved.mimeType || 'video/mp4',
          fileSize: BigInt(retrieved.contentLength),
          metadata: {
            episodeId,
            seriesId,
            clipId,
            clipIndex: clip.clipIndex,
            provider: 'xai',
            providerModel: model,
            providerRequestId,
            sourceUrlHost: retrieved.sourceUrlHost,
            durationSeconds,
          } as Prisma.InputJsonValue,
        },
      });

      const actualCostUsd =
        poll.actualCostUsd != null && Number.isFinite(poll.actualCostUsd)
          ? poll.actualCostUsd
          : estimatedCostUsd;

      const updated = await this.prisma.episodeVideoClip.update({
        where: { id: clipId },
        data: {
          status: EpisodeVideoClipStatus.COMPLETED,
          videoMediaAssetId: media.id,
          actualCostUsd: new Prisma.Decimal(actualCostUsd.toFixed(6)),
          errorMessage: null,
          metadata: {
            ...((clip.metadata as Record<string, unknown> | null) ?? {}),
            completedAt: new Date().toISOString(),
            mocked: poll.mock === true,
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `Clip completed episode=${episodeId} clip=${clip.clipIndex} id=${clipId} cost~$${actualCostUsd}`,
      );

      return {
        clipId,
        status: updated.status,
        videoMediaAssetId: media.id,
        actualCostUsd,
        providerRequestId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.episodeVideoClip.update({
        where: { id: clipId },
        data: {
          status: EpisodeVideoClipStatus.FAILED,
          errorMessage: message.slice(0, 4000),
        },
      });
      this.logger.error(`Clip failed episode=${episodeId} clip=${clipId}: ${message}`);
      throw error;
    }
  }

  async handleQueueJob(payload: SeriesClipGenerationPayload) {
    if (payload.action === 'cancel_episode') {
      return this.cancelEpisodeClips(payload.userId, payload.seriesId, payload.episodeId);
    }
    if (payload.action === 'generate_episode') {
      return this.generateEpisodeClips(payload.userId, payload.seriesId, payload.episodeId, {
        useMockAi: payload.useMockAi,
        force: payload.force,
        async: false,
        mode: payload.mode,
      });
    }
    if (payload.action === 'generate_clip' || payload.action === 'process_clip') {
      if (!payload.clipId) {
        throw new BadRequestException('clipId is required for process_clip');
      }
      return this.processClip(
        payload.userId,
        payload.seriesId,
        payload.episodeId,
        payload.clipId,
        {
          useMockAi: payload.useMockAi,
          force: payload.force,
          mode: payload.mode,
        },
      );
    }
    throw new BadRequestException(`Unknown clip generation action: ${payload.action}`);
  }

  private async resolveMode(
    clip: {
      speakerName: string | null;
      characters: unknown;
      episode: {
        series: {
          characters: Array<{
            name: string;
            referenceAssets: Array<{ mediaAsset: { storageKey: string } | null }>;
          }>;
        };
      };
    },
    requested: SeriesClipGenerationMode,
  ): Promise<'text_to_video' | 'image_to_video'> {
    if (requested === 'text_to_video') return 'text_to_video';
    if (requested === 'image_to_video') {
      const url = await this.resolveReferenceImageUrl(clip).catch(() => null);
      if (!url) {
        throw new BadRequestException(
          'image_to_video requested but no approved character reference still was found',
        );
      }
      return 'image_to_video';
    }
    // auto → prefer image-to-video when an approved character reference still exists
    // so human faces stay consistent across ≤15s packs; otherwise T2V.
    const refUrl = await this.resolveReferenceImageUrl(clip).catch(() => null);
    return refUrl ? 'image_to_video' : 'text_to_video';
  }

  private async resolveReferenceImageUrl(clip: {
    speakerName: string | null;
    characters: unknown;
    episode: {
      series: {
        characters: Array<{
          name: string;
          referenceAssets: Array<{ mediaAsset: { storageKey: string } | null }>;
        }>;
      };
    };
  }): Promise<string | undefined> {
    const names = [
      clip.speakerName,
      ...(Array.isArray(clip.characters) ? (clip.characters as string[]) : []),
    ]
      .map((n) => (n ?? '').trim().toLowerCase())
      .filter(Boolean);

    const characters = clip.episode.series.characters;
    const match =
      characters.find((c) => names.includes(c.name.toLowerCase()) && c.referenceAssets[0]?.mediaAsset) ??
      characters.find((c) => c.referenceAssets[0]?.mediaAsset);

    const storageKey = match?.referenceAssets[0]?.mediaAsset?.storageKey;
    if (!storageKey) return undefined;

    const stream = await this.storage.getObjectStream(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    const mime = stream.contentType || 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  private async submitWithOptionalMock(
    input: {
      mode: 'text_to_video' | 'image_to_video';
      prompt: string;
      durationSeconds: number;
      resolution: string;
      aspectRatio: string;
      model: string;
      externalTaskId: string;
      imageUrl?: string;
    },
    useMock: boolean,
  ) {
    const run = async () => {
      if (input.mode === 'image_to_video') {
        if (!input.imageUrl) {
          throw new Error('I2V submit missing imageUrl');
        }
        return this.xai.submitImageToVideo({
          imageUrl: input.imageUrl,
          motionPrompt: input.prompt,
          durationSeconds: input.durationSeconds,
          resolution: input.resolution,
          model: input.model,
          externalTaskId: input.externalTaskId,
          audio: 'native',
          aspectRatio: input.aspectRatio,
        });
      }
      return this.xai.submitTextToVideo!({
        prompt: input.prompt,
        durationSeconds: input.durationSeconds,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
        model: input.model,
        externalTaskId: input.externalTaskId,
        audio: 'native',
      });
    };

    let submit = await run();
    if (useMock && !submit.mock) {
      const previous = process.env.XAI_VIDEO_USE_MOCK;
      process.env.XAI_VIDEO_USE_MOCK = 'true';
      try {
        submit = await run();
      } finally {
        if (previous === undefined) delete process.env.XAI_VIDEO_USE_MOCK;
        else process.env.XAI_VIDEO_USE_MOCK = previous;
      }
    }
    if (useMock && !submit.mock) {
      throw new Error('Mock clip generation requested but xAI provider did not return a mock submit');
    }
    return submit;
  }

  private async pollUntilDone(providerRequestId: string, _useMock: boolean) {
    const intervalSeconds = this.config.get<number>('integrations.xaiVideoPollIntervalSeconds', 5);
    const intervalMs = Math.max(250, Math.round(intervalSeconds * 1000));
    const maxAttempts = this.config.get<number>('integrations.xaiVideoMaxPollAttempts', 120);

    let last = await this.safeGetTaskStatus(providerRequestId);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (
        last.status === 'succeeded' ||
        last.status === 'failed' ||
        last.status === 'cancelled'
      ) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      last = await this.safeGetTaskStatus(providerRequestId);
    }
    return last;
  }

  /** Never let a single status-network blip abort an in-flight Grok request. */
  private async safeGetTaskStatus(providerRequestId: string) {
    try {
      return await this.xai.getTaskStatus(providerRequestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|econnreset|429|502|503|504|unavailable|rate/i.test(message)) {
        this.logger.warn(`Ignoring transient xAI poll error for ${providerRequestId}: ${message}`);
        return {
          providerTaskId: providerRequestId,
          status: 'processing' as const,
          message: `transient:${message}`.slice(0, 500),
          outputs: [] as [],
        };
      }
      throw error;
    }
  }

  private assertXaiReady(useMock: boolean) {
    if (useMock) return;
    if (!isXaiVideoProviderEnabled(process.env)) {
      throw new BadRequestException(
        'xAI Grok video is disabled. Set XAI_VIDEO_ENABLED=true to generate clips.',
      );
    }
    if (!this.xai.isConfigured()) {
      throw new BadRequestException(
        'XAI_API_KEY is not configured. Add your xAI key to .env, or enable Use mock AI for placeholder clips only.',
      );
    }
  }

  private async assertBudgetAllows(userId: string, durationSeconds: number) {
    const maxMonthly = this.config.get<string>('integrations.xaiVideoMaxMonthlySpendUsd');
    if (!maxMonthly) return;
    const limit = Number.parseFloat(maxMonthly);
    if (!Number.isFinite(limit) || limit <= 0) return;

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const usages = await this.prisma.providerUsage.findMany({
      where: {
        userId,
        provider: 'xai',
        createdAt: { gte: startOfMonth },
      },
      select: { estimatedCost: true },
    });
    const spent = usages.reduce((sum, row) => sum + Number(row.estimatedCost), 0);
    const resolution = normalizeXaiVideoResolution(
      this.config.get<string>('integrations.xaiVideoResolution', '720p'),
    );
    const upcoming = this.xai.estimateCost(durationSeconds, resolution);
    if (spent + upcoming > limit) {
      throw new BadRequestException(
        `Monthly xAI video budget of $${limit} would be exceeded (spent $${spent.toFixed(4)}, requested ~$${upcoming.toFixed(4)})`,
      );
    }
  }

  private async requireEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      select: { id: true, seriesId: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }
}
