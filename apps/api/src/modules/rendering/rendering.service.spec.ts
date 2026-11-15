import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AudioGenerationStatus,
  JobStatus,
  MotionGenerationStatus,
  NarrationScriptStatus,
  SceneNarrationStatus,
  VideoRenderStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import { RenderingService } from './rendering.service';

function createService(overrides?: {
  story?: Record<string, unknown> | null;
  scenes?: unknown[];
  activeRender?: unknown;
  enqueue?: jest.Mock;
  musicAsset?: unknown;
}) {
  const story = overrides?.story === undefined ? { id: 'story-1', title: 'T', userId: 'user-1' } : overrides.story;
  const scenes =
    overrides?.scenes ??
    [
      {
        id: 'scene-1',
        sceneNumber: 1,
        durationSeconds: 4,
        narration: 'Hello',
        visuals: [
          {
            id: 'vis-1',
            isSelected: true,
            generationStatus: VisualGenerationStatus.COMPLETED,
            generatedImageMediaId: 'media-img',
            generatedImageMedia: { id: 'media-img', storageKey: 'img.png' },
          },
        ],
        motionGenerations: [
          {
            id: 'mot-1',
            isSelected: true,
            status: MotionGenerationStatus.COMPLETED,
            durationSeconds: 5,
            outputMediaAssetId: 'media-vid',
            outputMediaAsset: { id: 'media-vid', storageKey: 'clip.mp4' },
          },
        ],
        audioGenerations: [
          {
            id: 'aud-1',
            isSelected: true,
            status: AudioGenerationStatus.COMPLETED,
            duration: 3.5,
            audioMediaAssetId: 'media-aud',
            audioMediaAsset: { id: 'media-aud', storageKey: 'n.wav' },
            sceneNarrationId: 'sn-1',
          },
        ],
        sceneNarrations: [
          {
            id: 'sn-1',
            text: 'Hello there.',
            status: SceneNarrationStatus.APPROVED,
            estimatedDuration: 3.5,
            narrationScript: { id: 'ns-1', status: NarrationScriptStatus.APPROVED },
          },
        ],
      },
    ];

  const prisma = {
    story: {
      findFirst: jest.fn().mockResolvedValue(story),
    },
    storyScene: {
      findMany: jest.fn().mockResolvedValue(scenes),
    },
    narrationScript: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ns-1', status: NarrationScriptStatus.APPROVED }),
    },
    videoRender: {
      findFirst: jest.fn().mockResolvedValue(overrides?.activeRender ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'render-1',
        ...data,
        scenes: [],
        outputMediaAsset: null,
        subtitleMediaAsset: null,
        backgroundMusicAsset: null,
        generationJob: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    generationJob: {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      update: jest.fn(),
    },
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(overrides?.musicAsset ?? null),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        generationJob: {
          create: jest.fn().mockResolvedValue({ id: 'job-1' }),
        },
        videoRender: {
          create: jest.fn().mockResolvedValue({
            id: 'render-1',
            userId: 'user-1',
            storyId: 'story-1',
            status: VideoRenderStatus.PENDING,
            generationJobId: 'job-1',
          }),
        },
      }),
    ),
  };

  const queueService = {
    enqueueGenerationJob:
      overrides?.enqueue ??
      jest.fn().mockResolvedValue({ job: { id: 'bull-1' }, queueName: 'video-render-planning' }),
    removeJob: jest.fn().mockResolvedValue(true),
  };

  const storage = {
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/file'),
  };

  const service = new RenderingService(prisma as never, queueService as never, storage as never);
  return { service, prisma, queueService, storage };
}

describe('RenderingService', () => {
  it('reports readiness when all scene assets are selected', async () => {
    const { service } = createService();
    const readiness = await service.getReadiness('user-1', 'story-1');
    expect(readiness.canRender).toBe(true);
    expect(readiness.readyScenes).toBe(1);
    expect(readiness.missing).toEqual([]);
  });

  it('blocks render when narration audio is missing', async () => {
    const { service } = createService({
      scenes: [
        {
          id: 'scene-1',
          sceneNumber: 1,
          durationSeconds: 4,
          narration: 'Hello',
          visuals: [
            {
              id: 'vis-1',
              isSelected: true,
              generationStatus: VisualGenerationStatus.COMPLETED,
              generatedImageMediaId: 'media-img',
              generatedImageMedia: { id: 'media-img', storageKey: 'img.png' },
            },
          ],
          motionGenerations: [],
          audioGenerations: [],
          sceneNarrations: [
            {
              id: 'sn-1',
              text: 'Hello',
              status: SceneNarrationStatus.APPROVED,
              estimatedDuration: 3,
              narrationScript: { id: 'ns-1', status: NarrationScriptStatus.APPROVED },
            },
          ],
        },
      ],
    });

    const readiness = await service.getReadiness('user-1', 'story-1');
    expect(readiness.canRender).toBe(false);
    expect(readiness.missing.some((m) => m.includes('narration audio'))).toBe(true);
  });

  it('rejects create when another render is active', async () => {
    const { service } = createService({
      activeRender: { id: 'r-active', status: VideoRenderStatus.RENDERING_SCENES },
    });
    await expect(service.createRender('user-1', 'story-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('enqueues planning job when story is ready', async () => {
    const { service, queueService, prisma } = createService();
    prisma.videoRender.findFirst
      .mockResolvedValueOnce(null) // active check
      .mockResolvedValueOnce({
        id: 'render-1',
        userId: 'user-1',
        storyId: 'story-1',
        status: VideoRenderStatus.PENDING,
        renderType: 'final',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        frameRate: 30,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        qualityPreset: 'medium',
        subtitleEnabled: true,
        subtitleBurnedIn: true,
        backgroundMusicAssetId: null,
        renderSettings: {},
        timeline: null,
        duration: null,
        fileSize: null,
        processingTimeMs: null,
        retryCount: 0,
        currentSceneSequence: null,
        completedSceneCount: 0,
        totalSceneCount: 1,
        progress: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        outputMediaAssetId: null,
        subtitleMediaAssetId: null,
        generationJobId: 'job-1',
        scenes: [],
        outputMediaAsset: null,
        subtitleMediaAsset: null,
        backgroundMusicAsset: null,
        generationJob: { id: 'job-1', status: JobStatus.QUEUED, progress: 0, jobType: 'RENDER', errorMessage: null },
      });

    const result = await service.createRender('user-1', 'story-1', {
      profileId: 'vertical-9x16-1080p30',
      subtitleEnabled: true,
    });

    expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
      'RENDER',
      expect.objectContaining({
        generationJobId: 'job-1',
        storyId: 'story-1',
        jobType: 'RENDER',
      }),
    );
    expect(result.id).toBe('render-1');
  });

  it('throws BadRequest when assets are incomplete', async () => {
    const { service } = createService({
      scenes: [
        {
          id: 'scene-1',
          sceneNumber: 1,
          durationSeconds: 4,
          narration: 'Hello',
          visuals: [],
          motionGenerations: [],
          audioGenerations: [],
          sceneNarrations: [],
        },
      ],
    });
    await expect(service.createRender('user-1', 'story-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
