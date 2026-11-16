import { VideoRenderStatus } from '@prisma/client';
import { SeriesEpisodeQualityService } from './series-episode-quality.service';

describe('SeriesEpisodeQualityService', () => {
  it('fails when render output asset is missing', async () => {
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

    const service = new SeriesEpisodeQualityService(prisma as never);
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.passed).toBe(false);
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

    const service = new SeriesEpisodeQualityService(prisma as never);
    const result = await service.evaluateRenderedEpisode('user-1', 'ep-1');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });
});
