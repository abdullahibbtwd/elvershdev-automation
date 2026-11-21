import { EpisodeVideoClipStatus, VideoRenderStatus } from '@prisma/client';
import { SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER } from '@ai-video/shared';
import { ClipAssemblyService } from './clip-assembly.service';

describe('Phase 5 clip assembly', () => {
  it('dialogue stage order uses CLIP_GENERATION + ASSEMBLY instead of narration RENDER', () => {
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).toEqual([
      'MATERIALIZE',
      'CLIP_GENERATION',
      'ASSEMBLY',
      'DONE',
    ]);
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).not.toContain('RENDER');
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).not.toContain('VISUAL_INTELLIGENCE');
    expect(SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER).not.toContain('LIP_SYNC');
  });

  it('reports readyToAssemble only when every clip is COMPLETED with media', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ep-1',
          videoRenderId: null,
          actualDurationSeconds: null,
          episodeNumber: 1,
        }),
      },
      episodeVideoClip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            clipIndex: 0,
            status: EpisodeVideoClipStatus.COMPLETED,
            durationSeconds: 8,
            videoMediaAssetId: 'm1',
          },
          {
            id: 'c2',
            clipIndex: 1,
            status: EpisodeVideoClipStatus.GENERATING,
            durationSeconds: 8,
            videoMediaAssetId: null,
          },
        ]),
      },
      videoRender: { findUnique: jest.fn() },
    };

    const service = new ClipAssemblyService(
      prisma as never,
      {} as never,
      { getQueue: jest.fn() } as never,
    );

    const status = await service.getAssemblyStatus('u1', 's1', 'ep-1');
    expect(status.readyToAssemble).toBe(false);
    expect(status.completedClipCount).toBe(1);
    expect(status.missingClips).toHaveLength(1);
  });

  it('skips enqueue when assembly already completed unless force', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ep-1',
          videoRenderId: 'vr-1',
          actualDurationSeconds: 60,
          episodeNumber: 1,
        }),
      },
      episodeVideoClip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            clipIndex: 0,
            status: EpisodeVideoClipStatus.COMPLETED,
            durationSeconds: 8,
            videoMediaAssetId: 'm1',
          },
        ]),
      },
      videoRender: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vr-1',
          status: VideoRenderStatus.COMPLETED,
          outputMediaAssetId: 'out-1',
          duration: 60,
          renderSettings: { source: 'clip_assembly' },
          outputMediaAsset: { id: 'out-1', storageKey: 'k', mimeType: 'video/mp4', fileSize: 1 },
        }),
      },
    };
    const queues = { getQueue: jest.fn() };
    const service = new ClipAssemblyService(prisma as never, {} as never, queues as never);

    const result = await service.enqueueAssemble('u1', 's1', 'ep-1', { async: true });
    expect(result.skipped).toBe(true);
    expect(queues.getQueue).not.toHaveBeenCalled();
  });
});
