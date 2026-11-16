import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VideoRenderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type SeriesEpisodeQualityResult = {
  passed: boolean;
  score: number;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
  blockedReason?: string;
};

/**
 * Automated post-render quality gate for Series Studio.
 * Failed checks must never mark an episode ready to publish.
 */
@Injectable()
export class SeriesEpisodeQualityService {
  private readonly logger = new Logger(SeriesEpisodeQualityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluateRenderedEpisode(
    userId: string,
    episodeId: string,
  ): Promise<SeriesEpisodeQualityResult> {
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
        checks: [{ id: 'episode_exists', passed: false, detail: 'Episode not found' }],
        blockedReason: 'quality_episode_missing',
      };
    }

    const checks: SeriesEpisodeQualityResult['checks'] = [];

    const hasScript = Boolean(episode.script?.trim());
    checks.push({
      id: 'script_present',
      passed: hasScript,
      detail: hasScript ? 'Script present' : 'Script missing',
    });

    const hasScenes = await this.prisma.episodeScene.count({ where: { episodeId } });
    checks.push({
      id: 'scenes_present',
      passed: hasScenes > 0,
      detail: hasScenes > 0 ? `${hasScenes} scenes` : 'No scenes',
    });

    let renderOk = false;
    let durationOk = true;
    let assetOk = false;

    if (!episode.videoRenderId) {
      checks.push({
        id: 'render_row',
        passed: false,
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
        detail: render
          ? `Render status=${render.status}`
          : 'Render row missing',
      });
      checks.push({
        id: 'output_asset',
        passed: assetOk,
        detail: assetOk ? 'Output media asset present' : 'Missing output media asset',
      });

      const target = episode.targetDurationSeconds ?? episode.series.targetEpisodeDurationSeconds;
      const actual =
        typeof render?.duration === 'number'
          ? render.duration
          : episode.actualDurationSeconds;
      if (target && actual) {
        const delta = Math.abs(actual - target);
        // Allow generous tolerance for short-form 40–60s content.
        durationOk = delta <= Math.max(20, target * 0.5);
        checks.push({
          id: 'duration_tolerance',
          passed: durationOk,
          detail: `actual=${actual}s target=${target}s delta=${delta}s`,
        });
      } else {
        checks.push({
          id: 'duration_tolerance',
          passed: true,
          detail: 'Duration not available — skipped',
        });
      }
    }

    const passedCount = checks.filter((c) => c.passed).length;
    const score = checks.length ? passedCount / checks.length : 0;
    const passed = checks.every((c) => c.passed);

    const result: SeriesEpisodeQualityResult = {
      passed,
      score,
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
      this.logger.warn(
        `Episode quality failed episode=${episodeId} score=${score.toFixed(2)}`,
      );
    }

    return result;
  }
}
