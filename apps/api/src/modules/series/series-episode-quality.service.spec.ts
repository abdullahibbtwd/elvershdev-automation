import { VideoRenderStatus } from '@prisma/client';
import { SeriesEpisodeQualityService } from './series-episode-quality.service';

function makeConfigService(threshold = 0.7) {
  return {
    getOrCreate: jest.fn(async () => ({
      qualityAcceptanceThreshold: threshold,
    })),
  };
}

function makeDialogueProduction() {
  return {
    evaluateDialogueQuality: jest.fn(async () => ({
      passed: true,
      checks: [{ id: 'dialogue_mode', passed: true, detail: 'not dialogue-driven' }],
    })),
  };
}

describe('SeriesEpisodeQualityService', () => {
  it('fails when render output asset is missing (hard check)', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          script: 'hello',
          videoRenderId: 'render-1',
          targetDurationSeconds: 60,
          actualDurationSeconds: 55,
          metadata: {},
          series: { targetEpisodeDurationSeconds: 60 },
        })),
        update: jest.fn(async () => ({})),
      },
      episodeScene: {
        count: jest.fn(async () => 3),
      },
      videoRender: {
        findFirst: jest.fn(async () => ({
          id: 'render-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: null,
          duration: 55,
        })),
      },
    };

    const service = new SeriesEpisodeQualityService(
      prisma as never,
      makeConfigService(0.6) as never,
      makeDialogueProduction() as never,
    );
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.passed).toBe(false);
    expect(result.threshold).toBe(0.6);
    expect(result.checks.some((c) => c.id === 'output_asset' && !c.passed)).toBe(true);
    expect(prisma.seriesEpisode.update).toHaveBeenCalled();
  });

  it('passes when script, scenes, completed render and asset exist', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          script: 'hello',
          videoRenderId: 'render-1',
          targetDurationSeconds: 60,
          actualDurationSeconds: 58,
          metadata: {},
          series: { targetEpisodeDurationSeconds: 60 },
        })),
        update: jest.fn(async () => ({})),
      },
      episodeScene: {
        count: jest.fn(async () => 4),
      },
      videoRender: {
        findFirst: jest.fn(async () => ({
          id: 'render-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: 'asset-1',
          duration: 58,
        })),
      },
    };

    const service = new SeriesEpisodeQualityService(
      prisma as never,
      makeConfigService(0.7) as never,
      makeDialogueProduction() as never,
    );
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('passes dialogue-driven Grok path without lip-sync / TTS checks', async () => {
    const dialogueProduction = {
      evaluateDialogueQuality: jest.fn(async () => ({
        passed: true,
        checks: [
          { id: 'pipeline', passed: true, detail: 'Grok text-to-video' },
          { id: 'dialogue_lines_have_speakers', passed: true, hard: true, detail: '5 lines' },
          { id: 'min_two_speakers', passed: true, hard: true, detail: '2 speakers' },
          { id: 'grok_clips', passed: true, hard: true, detail: '6/6 Grok clips completed' },
          { id: 'duration_range', passed: true, hard: false, detail: '31s (target 30s)' },
        ],
      })),
    };
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          script: 'ELENA\nHello\nMAYA\nHi',
          videoRenderId: 'render-1',
          targetDurationSeconds: 30,
          actualDurationSeconds: 31,
          metadata: { dialogueDriven: true },
          series: { targetEpisodeDurationSeconds: 30 },
        })),
        update: jest.fn(async () => ({})),
      },
      episodeScene: { count: jest.fn(async () => 2) },
      videoRender: {
        findFirst: jest.fn(async () => ({
          id: 'render-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: 'asset-1',
          duration: 31,
        })),
      },
    };

    const service = new SeriesEpisodeQualityService(
      prisma as never,
      makeConfigService(0.7) as never,
      dialogueProduction as never,
    );
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.passed).toBe(true);
    expect(result.checks.some((c) => c.id.startsWith('dialogue_lip_sync'))).toBe(false);
    expect(dialogueProduction.evaluateDialogueQuality).toHaveBeenCalled();
  });

  it('passes soft duration miss when score still meets saved threshold', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          script: 'hello',
          videoRenderId: 'render-1',
          targetDurationSeconds: 60,
          actualDurationSeconds: 120,
          metadata: {},
          series: { targetEpisodeDurationSeconds: 60 },
        })),
        update: jest.fn(async () => ({})),
      },
      episodeScene: {
        count: jest.fn(async () => 3),
      },
      videoRender: {
        findFirst: jest.fn(async () => ({
          id: 'render-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: 'asset-1',
          duration: 120,
        })),
      },
    };

    const service = new SeriesEpisodeQualityService(
      prisma as never,
      makeConfigService(0.6) as never,
      makeDialogueProduction() as never,
    );
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.score).toBe(0.8);
    expect(result.threshold).toBe(0.6);
    expect(result.checks.some((c) => c.id === 'duration_tolerance' && !c.passed)).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('fails soft-only miss when score is below saved threshold', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          script: 'hello',
          videoRenderId: 'render-1',
          targetDurationSeconds: 60,
          actualDurationSeconds: 120,
          metadata: {},
          series: { targetEpisodeDurationSeconds: 60 },
        })),
        update: jest.fn(async () => ({})),
      },
      episodeScene: {
        count: jest.fn(async () => 3),
      },
      videoRender: {
        findFirst: jest.fn(async () => ({
          id: 'render-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: 'asset-1',
          duration: 120,
        })),
      },
    };

    const service = new SeriesEpisodeQualityService(
      prisma as never,
      makeConfigService(0.85) as never,
      makeDialogueProduction() as never,
    );
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(false);
  });
});
