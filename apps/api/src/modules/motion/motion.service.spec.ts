import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MotionGenerationStatus, VisualGenerationStatus } from '@prisma/client';
import { MotionService } from './motion.service';

describe('MotionService', () => {
  const userId = 'user-1';
  const storyId = 'story-1';
  const sceneId = 'scene-1';

  function createService(overrides?: {
    story?: unknown;
    scene?: unknown;
    sourceVisual?: unknown;
    enqueue?: jest.Mock;
  }) {
    const prisma = {
      story: {
        findFirst: jest.fn().mockResolvedValue(
          overrides?.story ?? {
            id: storyId,
            userId,
            scenes: [
              {
                id: sceneId,
                sceneNumber: 1,
                storyId,
                videoPrompt: 'slow push-in',
                visuals: [
                  {
                    id: 'visual-1',
                    generatedImageMediaId: 'media-1',
                    generationStatus: VisualGenerationStatus.COMPLETED,
                    isSelected: true,
                    attemptNumber: 1,
                  },
                ],
              },
            ],
          },
        ),
      },
      storyScene: {
        findFirst: jest.fn().mockResolvedValue(
          overrides?.scene ?? {
            id: sceneId,
            storyId,
            videoPrompt: 'slow push-in',
          },
        ),
      },
      sceneVisual: {
        findFirst: jest.fn().mockResolvedValue(
          overrides?.sourceVisual ?? {
            id: 'visual-1',
            sceneId,
            generatedImageMediaId: 'media-1',
            generationStatus: VisualGenerationStatus.COMPLETED,
          },
        ),
      },
      motionGeneration: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'motion-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'motion-1',
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      generationJob: {
        create: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'PENDING',
          progress: 0,
          jobType: 'MOTION_ANALYSIS',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'QUEUED',
          progress: 0,
          jobType: 'MOTION_ANALYSIS',
          queueJobId: 'bull-1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      providerUsage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );

    const queueService = {
      enqueueGenerationJob:
        overrides?.enqueue ??
        jest.fn().mockResolvedValue({
          job: { id: 'bull-1' },
          queueName: 'motion-analysis',
        }),
    };

    const storage = {
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/file'),
    };

    const jobsService = {
      getById: jest.fn(),
      retry: jest.fn(),
      cancel: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          'integrations.hailuoModel': 'fal-ai/minimax/hailuo-02/standard/image-to-video',
          'integrations.hailuoCurrency': 'USD',
          'integrations.hailuoDefaultDuration': 6,
          'integrations.hailuoDefaultResolution': '768P',
          'integrations.hailuoUseMock': 'true',
          'integrations.hailuoPricePerSecond768PUsd': '0.045',
          'integrations.hailuoPricePerSecond512PUsd': '0.017',
          'integrations.klingModel': 'kling-2.6',
          'integrations.klingCurrency': 'USD',
          'integrations.klingDefaultDurationSeconds': 5,
          'integrations.klingDefaultResolution': '720p',
          'integrations.klingMaxClipsPerScene': 10,
          'integrations.klingMaxAttemptsPerScene': 20,
          'integrations.klingUseMock': 'true',
          'integrations.geminiUseMock': 'true',
        };
        return map[key] ?? fallback;
      }),
    };

    const videoProviders = {
      getDefaultProviderId: jest.fn().mockReturnValue('hailuo'),
      resolveId: jest.fn((value?: string | null) =>
        value === 'kling' ? 'kling' : 'hailuo',
      ),
      assertSelectable: jest.fn(),
      validateSettings: jest.fn(),
      estimateCost: jest.fn().mockReturnValue(0.27),
      getModel: jest.fn((provider: string) =>
        provider === 'kling'
          ? 'kling-2.6'
          : 'fal-ai/minimax/hailuo-02/standard/image-to-video',
      ),
      getDefaultDuration: jest.fn((provider: string) => (provider === 'kling' ? 5 : 6)),
      getDefaultResolution: jest.fn((provider: string) =>
        provider === 'kling' ? '720p' : '768P',
      ),
      listAvailability: jest.fn().mockReturnValue([]),
      resolve: jest.fn().mockReturnValue({ shouldUseMock: () => true }),
    };

    const service = new MotionService(
      prisma as never,
      queueService as never,
      storage as never,
      jobsService as never,
      config as never,
      videoProviders as never,
    );

    return { service, prisma, queueService, videoProviders };
  }

  it('enqueues story motion generation when scenes have images', async () => {
    const { service, queueService, prisma } = createService();
    const result = await service.generateForStory(userId, storyId, {
      durationSeconds: 6,
      resolution: '768P',
    });

    expect(prisma.motionGeneration.create).toHaveBeenCalled();
    expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
      'MOTION_ANALYSIS',
      expect.objectContaining({
        storyId,
        jobType: 'MOTION_ANALYSIS',
        useMockAi: true,
      }),
      expect.any(Object),
    );
    expect(result.job.status).toBe('QUEUED');
  });

  it('rejects scenes without source images', async () => {
    const { service } = createService({
      story: {
        id: storyId,
        userId,
        scenes: [
          {
            id: sceneId,
            sceneNumber: 1,
            storyId,
            videoPrompt: 'pan',
            visuals: [],
          },
        ],
      },
    });

    await expect(service.generateForStory(userId, storyId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects concurrent scene motion jobs', async () => {
    const { service, prisma } = createService();
    prisma.motionGeneration.findFirst.mockResolvedValueOnce({
      id: 'active',
      status: MotionGenerationStatus.PROCESSING,
    });

    await expect(service.generateForScene(userId, sceneId, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns not found for foreign stories', async () => {
    const { service, prisma } = createService();
    prisma.story.findFirst.mockResolvedValue(null);
    await expect(service.listStoryMotion(userId, storyId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
