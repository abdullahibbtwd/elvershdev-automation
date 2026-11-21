import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EpisodeVideoClipStatus, Prisma } from '@prisma/client';
import {
  SERIES_DURATION_DEFAULTS,
  XAI_VIDEO_LITE_MODEL,
  assertClipPlanValid,
  buildEpisodeClipPlan,
  dialogueEpisodeScriptPlanSchema,
  parseSeriesCreativeSettings,
  type ClipPlanShotInput,
  type DialogueEpisodeScriptPlan,
  type EpisodeClipPlanResult,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DialogueProductionService } from './dialogue-production.service';
import { SeriesConfigService } from './series-config.service';

@Injectable()
export class ClipPlanningService {
  private readonly logger = new Logger(ClipPlanningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: SeriesConfigService,
    private readonly dialogueProduction: DialogueProductionService,
  ) {}

  async getClipPlan(userId: string, seriesId: string, episodeId: string) {
    await this.requireEpisode(userId, seriesId, episodeId);
    const clips = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId, userId },
      orderBy: { clipIndex: 'asc' },
    });
    const estimatedCostUsd = clips.reduce(
      (sum, clip) => sum + Number(clip.estimatedCostUsd ?? 0),
      0,
    );
    return {
      episodeId,
      clipCount: clips.length,
      totalDurationSeconds: Number(
        clips.reduce((sum, clip) => sum + clip.durationSeconds, 0).toFixed(2),
      ),
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      clips,
    };
  }

  /**
   * Build a shot-aware ≤15s clip plan from persisted EpisodeShot rows (or duration fallback).
   * Replaces prior PLANNED clips for the episode; leaves in-flight/completed clips unless force.
   */
  async planClips(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: { force?: boolean; persist?: boolean },
  ) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      include: {
        series: {
          include: {
            characters: true,
            lane: { select: { creativeSettings: true, maxClipDurationSeconds: true } },
          },
        },
        shots: {
          orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }],
          include: { dialogueLine: true },
        },
        scenes: { orderBy: { sceneOrder: 'asc' } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    if (!episode.script?.trim()) {
      throw new BadRequestException(
        'Episode needs a screenplay/script before a clip plan can be built',
      );
    }

    const existing = await this.prisma.episodeVideoClip.findMany({
      where: { episodeId },
      select: { id: true, status: true, clipIndex: true },
    });
    const locked = existing.filter(
      (clip) =>
        clip.status !== EpisodeVideoClipStatus.PLANNED &&
        clip.status !== EpisodeVideoClipStatus.FAILED &&
        clip.status !== EpisodeVideoClipStatus.CANCELLED,
    );
    if (locked.length > 0 && !options?.force) {
      throw new BadRequestException(
        `Cannot rebuild clip plan: ${locked.length} clip(s) already in progress or completed. Pass force=true to replace only PLANNED/FAILED/CANCELLED rows.`,
      );
    }

    const config = await this.configService.getOrCreate(userId);
    const seriesMeta = (episode.series.metadata ?? {}) as Record<string, unknown>;
    const creative = parseSeriesCreativeSettings(
      seriesMeta.creativeSettingsSnapshot ??
        episode.series.lane?.creativeSettings ??
        config.creativeSettings ??
        {},
    );

    const maxClipDurationSeconds = Math.min(
      SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
      Math.max(
        1,
        Number(
          creative.maxClipDurationSeconds ??
            episode.series.lane?.maxClipDurationSeconds ??
            config.defaultMaxClipDurationSeconds ??
            SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
        ) || SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
      ),
    );

    // Prefer real EpisodeShot rows. If missing, rematerialize from saved dialogue plan
    // so we never fall back to duplicating the full synopsis on every ≤15s pack.
    let shots = episode.shots;
    if (shots.length === 0) {
      const meta = (episode.metadata ?? {}) as Record<string, unknown>;
      const rawPlan = meta.dialoguePlan;
      if (rawPlan && typeof rawPlan === 'object') {
        try {
          const dialoguePlan = dialogueEpisodeScriptPlanSchema.parse(
            rawPlan,
          ) as DialogueEpisodeScriptPlan;
          await this.dialogueProduction.materializeDialoguePlan(
            userId,
            episodeId,
            dialoguePlan,
            { force: true },
          );
          shots = await this.prisma.episodeShot.findMany({
            where: { episodeId },
            orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }],
            include: { dialogueLine: true },
          });
          this.logger.log(
            `Rematerialized ${shots.length} dialogue shots before clip plan episode=${episodeId}`,
          );
        } catch (error) {
          this.logger.warn(
            `Could not rematerialize dialogue shots episode=${episodeId}: ${(error as Error).message}`,
          );
        }
      }
    }

    const sceneByOrder = new Map(
      episode.scenes.map((scene) => [scene.sceneOrder, scene] as const),
    );

    const shotInputs: ClipPlanShotInput[] = shots.map((shot) => {
      const scene = sceneByOrder.get(shot.sceneOrder);
      const meta = (shot.metadata ?? {}) as Record<string, unknown>;
      return {
        id: shot.id,
        sceneOrder: shot.sceneOrder,
        shotOrder: shot.shotOrder,
        shotType: shot.shotType,
        speakerName: shot.speakerName,
        dialogue: shot.dialogueLine?.text ?? (meta.dialogue as string | undefined) ?? '',
        charactersVisible: Array.isArray(shot.charactersVisible)
          ? (shot.charactersVisible as string[])
          : [],
        cameraDirection: shot.cameraDirection,
        cameraMovement: shot.cameraMovement,
        facialExpression: shot.facialExpression,
        bodyLanguage: shot.bodyLanguage,
        environment: shot.environment ?? scene?.location ?? null,
        lighting: shot.lighting,
        durationSeconds: shot.durationSeconds,
        ambientSound: (meta.ambientSound as string | undefined) ?? '',
        musicDirection: (meta.musicDirection as string | undefined) ?? '',
        location: scene?.location ?? shot.environment ?? null,
        sceneAction:
          [scene?.action, scene?.visualDescription].filter(Boolean).join(' — ') || null,
        keyProps: Array.isArray(meta.keyProps)
          ? (meta.keyProps as string[]).map((p) => String(p).trim()).filter(Boolean)
          : [],
      };
    });

    const plan = buildEpisodeClipPlan({
      episode: {
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        episodeSummary: episode.synopsis,
        episodeScript: episode.script,
        targetDurationSeconds: episode.targetDurationSeconds,
        maxClipDurationSeconds,
        visualStyle:
          (seriesMeta.visualStyle as string | undefined) ??
          creative.visualStyle ??
          config.visualDirection ??
          null,
        aspectRatio: creative.aspectRatio ?? '9:16',
        pricePerSecondUsd: 0.03,
      },
      shots: shotInputs,
      characters: episode.series.characters,
    });

    assertClipPlanValid(plan);
    const aspectRatio = (creative.aspectRatio ?? '9:16').trim() || '9:16';

    if (options?.persist === false) {
      return {
        episodeId,
        persisted: false,
        ...this.summarizePlan(plan),
        clips: plan.clips,
        notes: plan.notes,
        aspectRatio,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.episodeVideoClip.deleteMany({
        where: {
          episodeId,
          status: {
            in: [
              EpisodeVideoClipStatus.PLANNED,
              EpisodeVideoClipStatus.FAILED,
              EpisodeVideoClipStatus.CANCELLED,
            ],
          },
        },
      });

      if (options?.force) {
        await tx.episodeVideoClip.deleteMany({ where: { episodeId } });
      }

      for (const clip of plan.clips) {
        await tx.episodeVideoClip.create({
          data: {
            userId,
            episodeId,
            clipIndex: clip.clipIndex,
            sceneOrder: clip.sceneOrder,
            shotOrders: clip.shotOrders as Prisma.InputJsonValue,
            sourceShotIds: clip.sourceShotIds as Prisma.InputJsonValue,
            durationSeconds: clip.durationSeconds,
            startOffsetSeconds: clip.startOffsetSeconds,
            endOffsetSeconds: clip.endOffsetSeconds,
            characters: clip.characters as Prisma.InputJsonValue,
            speakerName: clip.speakerName,
            dialogue: clip.dialogue || null,
            location: clip.location,
            environment: clip.environment,
            camera: clip.camera,
            action: clip.action,
            audioDirection: clip.audioDirection || null,
            musicDirection: clip.musicDirection || null,
            previousClipSummary: clip.previousClipSummary,
            nextClipHint: clip.nextClipHint,
            prompt: clip.prompt,
            continuity: clip.continuity as Prisma.InputJsonValue,
            status: EpisodeVideoClipStatus.PLANNED,
            provider: 'xai',
            providerModel: XAI_VIDEO_LITE_MODEL,
            estimatedCostUsd: new Prisma.Decimal(
              (clip.durationSeconds * plan.pricePerSecondUsd).toFixed(6),
            ),
            idempotencyKey: `ep-clip:${episodeId}:${clip.clipIndex}:v1`,
            metadata: {
              maxClipDurationSeconds: plan.maxClipDurationSeconds,
              aspectRatio,
              notes: plan.notes,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await tx.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          metadata: {
            ...((episode.metadata as Record<string, unknown> | null) ?? {}),
            clipPlan: {
              clipCount: plan.clipCount,
              totalDurationSeconds: plan.totalDurationSeconds,
              estimatedCostUsd: plan.estimatedCostUsd,
              maxClipDurationSeconds: plan.maxClipDurationSeconds,
              aspectRatio,
              plannedAt: new Date().toISOString(),
              notes: plan.notes,
            },
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `Clip plan ready episode=${episodeId} clips=${plan.clipCount} duration=${plan.totalDurationSeconds}s cost~$${plan.estimatedCostUsd}`,
    );

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.episode.clip_plan',
        entityType: 'SeriesEpisode',
        entityId: episodeId,
        after: {
          clipCount: plan.clipCount,
          totalDurationSeconds: plan.totalDurationSeconds,
          estimatedCostUsd: plan.estimatedCostUsd,
          force: options?.force === true,
        },
      },
    });

    const stored = await this.getClipPlan(userId, seriesId, episodeId);
    return {
      ...stored,
      persisted: true,
      notes: plan.notes,
      maxClipDurationSeconds: plan.maxClipDurationSeconds,
      pricePerSecondUsd: plan.pricePerSecondUsd,
    };
  }

  /** Estimate without writing rows. */
  async estimateClipPlan(userId: string, seriesId: string, episodeId: string) {
    return this.planClips(userId, seriesId, episodeId, { persist: false });
  }

  private summarizePlan(plan: EpisodeClipPlanResult) {
    return {
      clipCount: plan.clipCount,
      totalDurationSeconds: plan.totalDurationSeconds,
      estimatedCostUsd: plan.estimatedCostUsd,
      maxClipDurationSeconds: plan.maxClipDurationSeconds,
      pricePerSecondUsd: plan.pricePerSecondUsd,
    };
  }

  private async requireEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }
}
