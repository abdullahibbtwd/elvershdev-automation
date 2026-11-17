import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VideoRenderStatus } from '@prisma/client';
import { SERIES_DEFAULTS } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SeriesConfigService } from './series-config.service';

export type SeriesEpisodeQualityResult = {
  passed: boolean;
  score: number;
  threshold: number;
  checks: Array<{ id: string; passed: boolean; hard?: boolean; detail: string }>;
  blockedReason?: string;
};

/**
 * Automated post-render quality gate for Series Studio.
 * Soft checks contribute to score; hard checks (render + asset) always required.
 * Pass when hard checks succeed AND score >= Series Settings qualityAcceptanceThreshold.
 */
@Injectable()
export class SeriesEpisodeQualityService {
  private readonly logger = new Logger(SeriesEpisodeQualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: SeriesConfigService,
  ) {}

  async evaluateRenderedEpisode(
    userId: string,
    episodeId: string,
  ): Promise<SeriesEpisodeQualityResult> {
    const config = await this.configService.getOrCreate(userId);
    const threshold =
      typeof config.qualityAcceptanceThreshold === 'number'
        ? config.qualityAcceptanceThreshold
        : SERIES_DEFAULTS.qualityAcceptanceThreshold;

    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, series: { userId } },
      include: {
        series: {
          select: {
            targetEpisodeDurationSeconds: true,
            qualityScores: true,
          },
        },
      },
    });

    if (!episode) {
      return {
        passed: false,
        score: 0,
        threshold,
        checks: [{ id: 'episode_exists', passed: false, hard: true, detail: 'Episode not found' }],
        blockedReason: 'quality_episode_missing',
      };
    }

    const checks: SeriesEpisodeQualityResult['checks'] = [];

    const hasScript = Boolean(episode.script?.trim());
    checks.push({
      id: 'script_present',
      passed: hasScript,
      hard: true,
      detail: hasScript ? 'Script present' : 'Script missing',
    });

    const hasScenes = await this.prisma.episodeScene.count({ where: { episodeId } });
    checks.push({
      id: 'scenes_present',
      passed: hasScenes > 0,
      hard: true,
      detail: hasScenes > 0 ? `${hasScenes} scenes` : 'No scenes',
    });

    let renderOk = false;
    let durationOk = true;
    let assetOk = false;

    if (!episode.videoRenderId) {
      checks.push({
        id: 'render_row',
        passed: false,
        hard: true,
        detail: 'No videoRenderId on episode',
      });
    } else {
      const render = await this.prisma.videoRender.findFirst({
        where: { id: episode.videoRenderId, userId },
      });
      renderOk = render?.status === VideoRenderStatus.COMPLETED;
      assetOk = Boolean(render?.outputMediaAssetId);
      checks.push({
        id: 'render_completed',
        passed: renderOk,
        hard: true,
        detail: render ? `Render status=${render.status}` : 'Render row missing',
      });
      checks.push({
        id: 'output_asset',
        passed: assetOk,
        hard: true,
        detail: assetOk ? 'Output media asset present' : 'Missing output media asset',
      });

      const target = episode.targetDurationSeconds ?? episode.series.targetEpisodeDurationSeconds;
      const actual =
        typeof render?.duration === 'number'
          ? render.duration
          : episode.actualDurationSeconds;
      if (target && actual) {
        const delta = Math.abs(actual - target);
        // Soft check — can fail without hard-failing if score still meets threshold.
        durationOk = delta <= Math.max(20, target * 0.5);
        checks.push({
          id: 'duration_tolerance',
          passed: durationOk,
          hard: false,
          detail: `actual=${actual}s target=${target}s delta=${delta}s`,
        });
      } else {
        checks.push({
          id: 'duration_tolerance',
          passed: true,
          hard: false,
          detail: 'Duration not available — skipped',
        });
      }
    }

    const passedCount = checks.filter((c) => c.passed).length;
    const score = checks.length ? passedCount / checks.length : 0;
    const hardFailed = checks.some((c) => c.hard && !c.passed);
    const passed = !hardFailed && score >= threshold;

    const result: SeriesEpisodeQualityResult = {
      passed,
      score,
      threshold,
      checks,
      blockedReason: passed ? undefined : 'quality_check_failed',
    };

    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        blockedReason: passed ? null : 'quality_check_failed',
        metadata: {
          ...((episode.metadata as Record<string, unknown> | null) ?? {}),
          qualityCheck: {
            ...result,
            evaluatedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    if (!passed) {
      const failedIds = checks.filter((c) => !c.passed).map((c) => c.id).join(',');
      this.logger.warn(
        `Episode quality failed episode=${episodeId} score=${score.toFixed(2)} threshold=${threshold} hardFailed=${hardFailed} failed=[${failedIds}]`,
      );
    }

    return result;
  }
}
