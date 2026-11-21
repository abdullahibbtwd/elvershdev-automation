import { EpisodeVideoClipStatus } from '@prisma/client';
import { XAI_VIDEO_LITE_MODEL } from '@ai-video/shared';
import { ClipGenerationService } from './clip-generation.service';

describe('ClipGenerationService (Phase 4)', () => {
  const userId = 'user-1';
  const seriesId = 'series-1';
  const episodeId = 'episode-1';
  const clipId = 'clip-1';

  function createService(overrides?: {
    clip?: Record<string, unknown>;
    xai?: Partial<{
      shouldUseMock: () => boolean;
      isConfigured: () => boolean;
      getModel: () => string;
      estimateCost: (d: number, r: string) => number;
      submitTextToVideo: jest.Mock;
      submitImageToVideo: jest.Mock;
      getTaskStatus: jest.Mock;
      retrieveCompletedVideo: jest.Mock;
    }>;
  }) {
    const clipRow = {
      id: clipId,
      userId,
      episodeId,
      clipIndex: 0,
      sceneOrder: 1,
      shotOrders: [1],
      sourceShotIds: [],
      durationSeconds: 8,
      startOffsetSeconds: 0,
      endOffsetSeconds: 8,
      characters: ['Amina'],
      speakerName: 'Amina',
      dialogue: 'Amina: Hello',
      location: 'Living room',
      environment: 'Dim room',
      camera: 'Close-up',
      action: 'speaks',
      audioDirection: null,
      musicDirection: null,
      previousClipSummary: null,
      nextClipHint: null,
      prompt: 'CLIP INFORMATION\nAmina speaks.',
      continuity: {},
      status: EpisodeVideoClipStatus.PLANNED,
      provider: 'xai',
      providerModel: XAI_VIDEO_LITE_MODEL,
      providerRequestId: null,
      videoMediaAssetId: null,
      estimatedCostUsd: 0.24,
      actualCostUsd: null,
      errorMessage: null,
      metadata: {},
      episode: {
        seriesId,
        series: {
          characters: [
            {
              name: 'Amina',
              referenceAssets: [],
            },
          ],
        },
      },
      ...overrides?.clip,
    };

    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn().mockResolvedValue({ id: episodeId, seriesId }),
      },
      episodeVideoClip: {
        findFirst: jest.fn().mockResolvedValue(clipRow),
        findMany: jest.fn().mockResolvedValue([clipRow]),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...clipRow,
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mediaAsset: {
        create: jest.fn().mockResolvedValue({ id: 'media-1' }),
      },
      providerUsage: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      seriesAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const queues = {
      getQueue: jest.fn().mockReturnValue({
        add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      }),
    };

    const xai = {
      shouldUseMock: jest.fn().mockReturnValue(true),
      isConfigured: jest.fn().mockReturnValue(false),
      getModel: jest.fn().mockReturnValue(XAI_VIDEO_LITE_MODEL),
      estimateCost: jest.fn().mockReturnValue(0.24),
      submitTextToVideo: jest.fn().mockResolvedValue({
        providerTaskId: 'mock-xai-task-1',
        status: 'submitted',
        estimatedCostUsd: 0.24,
        currency: 'USD',
        model: `mock:${XAI_VIDEO_LITE_MODEL}`,
        mock: true,
      }),
      submitImageToVideo: jest.fn(),
      getTaskStatus: jest
        .fn()
        .mockResolvedValueOnce({
          providerTaskId: 'mock-xai-task-1',
          status: 'processing',
          outputs: [],
          mock: true,
        })
        .mockResolvedValue({
          providerTaskId: 'mock-xai-task-1',
          status: 'succeeded',
          outputs: [{ type: 'video', url: 'mock://xai/mock-xai-task-1.mp4' }],
          actualCostUsd: 0.24,
          mock: true,
        }),
      retrieveCompletedVideo: jest.fn().mockResolvedValue({
        buffer: Buffer.from('mock-mp4'),
        mimeType: 'video/mp4',
        contentLength: 8,
        sourceUrlHost: 'mock',
      }),
      ...overrides?.xai,
    };

    const storage = {
      uploadObject: jest.fn().mockResolvedValue(undefined),
      getObjectStream: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'integrations.xaiVideoPollIntervalSeconds') return 0.01;
        if (key === 'integrations.xaiVideoMaxPollAttempts') return 10;
        if (key === 'integrations.xaiVideoResolution') return '720p';
        if (key === 'integrations.xaiVideoMaxMonthlySpendUsd') return undefined;
        return fallback;
      }),
    };

    const characters = {
      generateReferencesForSeries: jest.fn().mockResolvedValue([]),
    };

    const service = new ClipGenerationService(
      prisma as never,
      queues as never,
      xai as never,
      storage as never,
      config as never,
      characters as never,
    );

    return { service, prisma, queues, xai, storage, characters };
  }

  it('processes a clip through submit → poll → download → MediaAsset', async () => {
    const { service, prisma, xai, storage } = createService();

    const result = await service.processClip(userId, seriesId, episodeId, clipId, {
      useMockAi: true,
      mode: 'text_to_video',
    });

    expect(xai.submitTextToVideo).toHaveBeenCalled();
    expect(xai.getTaskStatus).toHaveBeenCalled();
    expect(xai.retrieveCompletedVideo).toHaveBeenCalled();
    expect(storage.uploadObject).toHaveBeenCalledWith(
      `series/${seriesId}/episodes/${episodeId}/clips/${clipId}.mp4`,
      expect.any(Buffer),
      'video/mp4',
    );
    expect(prisma.mediaAsset.create).toHaveBeenCalled();
    expect(prisma.providerUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'xai',
          requestType: 'text_to_video_submit',
        }),
      }),
    );
    expect(result.status).toBe(EpisodeVideoClipStatus.COMPLETED);
    expect(result.videoMediaAssetId).toBe('media-1');
  });

  it('queues episode clip jobs without processing inline', async () => {
    const { service, queues, prisma } = createService();

    const result = await service.generateEpisodeClips(userId, seriesId, episodeId, {
      useMockAi: true,
      async: true,
    });

    expect(result.queued).toBe(true);
    expect(result.queuedClipIds).toEqual([clipId]);
    expect(queues.getQueue).toHaveBeenCalled();
    expect(prisma.episodeVideoClip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EpisodeVideoClipStatus.QUEUED }),
      }),
    );
  });

  it('resumes poll when providerRequestId already exists', async () => {
    const { service, xai } = createService({
      clip: {
        status: EpisodeVideoClipStatus.SUBMITTED,
        providerRequestId: 'mock-xai-existing',
      },
    });

    await service.processClip(userId, seriesId, episodeId, clipId, {
      useMockAi: true,
      mode: 'text_to_video',
    });

    expect(xai.submitTextToVideo).not.toHaveBeenCalled();
    expect(xai.getTaskStatus).toHaveBeenCalledWith('mock-xai-existing');
  });
});
