import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  GenerationJobType,
  JobStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { VisualStylesService } from '../visual-styles/visual-styles.service';
import { VisualsService } from './visuals.service';

describe('VisualsService', () => {
  function createService() {
    const prisma = {
      story: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      storyScene: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      characterProfile: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      sceneVisual: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      generationJob: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    const queueService = {
      enqueueGenerationJob: jest.fn(),
    };
    const storage = {
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://minio.local/presigned'),
    };
    const visualStylesService = {
      ensureAccessible: jest.fn().mockResolvedValue({ id: 'style-1' }),
      getDefault: jest.fn().mockResolvedValue({ id: 'default-style-1' }),
    };
    const jobsService = {
      getById: jest.fn(),
      retry: jest.fn(),
      cancel: jest.fn(),
    };

    const service = new VisualsService(
      prisma as unknown as PrismaService,
      queueService as unknown as QueueService,
      storage as unknown as StorageService,
      visualStylesService as unknown as VisualStylesService,
      jobsService as unknown as JobsService,
    );

    return {
      service,
      prisma,
      queueService,
      storage,
      visualStylesService,
      jobsService,
    };
  }

  it('rejects story visual generation when story has no scenes', async () => {
    const { service, prisma } = createService();
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      visualStyleId: null,
      scenes: [],
    });

    await expect(
      service.generateForStory('user-1', 'story-1', {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns 409 conflict when active visual job exists for story', async () => {
    const { service, prisma } = createService();
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      visualStyleId: 'style-1',
      scenes: [{ id: 'scene-1', sceneNumber: 1 }],
    });
    prisma.generationJob.findMany.mockResolvedValue([
      {
        id: 'job-active',
        jobType: GenerationJobType.VISUAL_ANALYSIS,
        status: JobStatus.PROCESSING,
        payload: {},
      },
    ]);

    await expect(
      service.generateForStory('user-1', 'story-1', {}),
    ).rejects.toThrow(ConflictException);
  });

  it('enqueues VISUAL_ANALYSIS job with deterministic jobId and sets story visualStyleId', async () => {
    const { service, prisma, queueService } = createService();
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      visualStyleId: null,
      scenes: [{ id: 'scene-1', sceneNumber: 1 }],
    });
    prisma.generationJob.findMany.mockResolvedValue([]);
    prisma.generationJob.create.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoProjectId: null,
      storyId: 'story-1',
      jobType: GenerationJobType.VISUAL_ANALYSIS,
      status: JobStatus.PENDING,
      progress: 0,
      provider: 'gemini',
      queueName: 'visual-analysis',
      queueJobId: null,
      attempts: 0,
      maxAttempts: 3,
      estimatedCost: null,
      actualCost: null,
      payload: {},
      result: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    queueService.enqueueGenerationJob.mockResolvedValue({
      queueName: 'visual-analysis',
      job: { id: 'job-1' },
    });
    prisma.generationJob.update.mockImplementation(async ({ data }) => ({
      id: 'job-1',
      userId: 'user-1',
      videoProjectId: null,
      storyId: 'story-1',
      jobType: GenerationJobType.VISUAL_ANALYSIS,
      status: data.status,
      progress: 0,
      provider: 'gemini',
      queueName: 'visual-analysis',
      queueJobId: data.queueJobId,
      attempts: 0,
      maxAttempts: 3,
      estimatedCost: null,
      actualCost: null,
      payload: {},
      result: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const result = await service.generateForStory('user-1', 'story-1', {
      visualStyleId: 'style-1',
    });

    expect(prisma.story.update).toHaveBeenCalledWith({
      where: { id: 'story-1' },
      data: { visualStyleId: 'style-1' },
    });
    expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
      'VISUAL_ANALYSIS',
      expect.objectContaining({
        generationJobId: 'job-1',
        storyId: 'story-1',
        payload: expect.objectContaining({
          action: 'analyze_story_visuals',
          visualStyleId: 'style-1',
        }),
      }),
      { attempts: 3 },
    );
    expect(result.job.status).toBe(JobStatus.QUEUED);
  });

  it('creates PROMPT_READY SceneVisual when prompt is provided on generateForScene', async () => {
    const { service, prisma, queueService } = createService();
    prisma.storyScene.findFirst.mockResolvedValue({
      id: 'scene-1',
      storyId: 'story-1',
      imagePrompt: 'Default prompt',
      story: { id: 'story-1', visualStyleId: 'style-1' },
      visuals: [{ attemptNumber: 1, visualPrompt: 'Old prompt', negativePrompt: null, generationStatus: VisualGenerationStatus.COMPLETED, generationJob: null }],
    });
    prisma.generationJob.findMany.mockResolvedValue([]);
    prisma.sceneVisual.create.mockResolvedValue({
      id: 'vis-2',
      sceneId: 'scene-1',
      visualPrompt: 'Custom prompt',
      generationStatus: VisualGenerationStatus.PROMPT_READY,
      attemptNumber: 2,
    });
    prisma.generationJob.create.mockResolvedValue({
      id: 'job-2',
      userId: 'user-1',
      videoProjectId: null,
      storyId: 'story-1',
      jobType: GenerationJobType.IMAGE,
      status: JobStatus.PENDING,
      progress: 0,
      provider: 'fal',
      queueName: 'image-generation',
      queueJobId: null,
      attempts: 0,
      maxAttempts: 3,
      estimatedCost: null,
      actualCost: null,
      payload: {},
      result: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    queueService.enqueueGenerationJob.mockResolvedValue({
      queueName: 'image-generation',
      job: { id: 'job-2' },
    });
    prisma.generationJob.update.mockImplementation(async ({ data }) => ({
      id: 'job-2',
      userId: 'user-1',
      videoProjectId: null,
      storyId: 'story-1',
      jobType: GenerationJobType.IMAGE,
      status: data.status,
      progress: 0,
      provider: 'fal',
      queueName: 'image-generation',
      queueJobId: data.queueJobId,
      attempts: 0,
      maxAttempts: 3,
      estimatedCost: null,
      actualCost: null,
      payload: {},
      result: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    prisma.sceneVisual.findUniqueOrThrow.mockResolvedValue({
      id: 'vis-2',
      sceneId: 'scene-1',
      visualPrompt: 'Custom prompt',
      generationStatus: VisualGenerationStatus.PROMPT_READY,
      attemptNumber: 2,
      generatedImageMedia: null,
    });

    const res = await service.generateForScene('user-1', 'scene-1', {
      visualPrompt: 'Custom prompt',
    });

    expect(prisma.sceneVisual.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sceneId: 'scene-1',
        visualPrompt: 'Custom prompt',
        generationStatus: VisualGenerationStatus.PROMPT_READY,
        attemptNumber: 2,
      }),
    });
    expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
      'IMAGE',
      expect.objectContaining({
        generationJobId: 'job-2',
        sceneId: 'scene-1',
        sceneVisualId: 'vis-2',
        payload: expect.objectContaining({
          action: 'generate_scene_image',
          sceneId: 'scene-1',
          sceneVisualId: 'vis-2',
        }),
      }),
      { attempts: 3 },
    );
    expect(res.sceneVisual.id).toBe('vis-2');
  });

  it('blocks prompt edit while SceneVisual is GENERATING and unsets prior selected on isSelected=true', async () => {
    const { service, prisma } = createService();
    prisma.sceneVisual.findFirst.mockResolvedValue({
      id: 'vis-1',
      sceneId: 'scene-1',
      generationStatus: VisualGenerationStatus.GENERATING,
    });

    await expect(
      service.updateSceneVisual('user-1', 'scene-1', 'vis-1', {
        visualPrompt: 'Edited',
      }),
    ).rejects.toThrow(ConflictException);

    prisma.sceneVisual.findFirst.mockResolvedValue({
      id: 'vis-1',
      sceneId: 'scene-1',
      generationStatus: VisualGenerationStatus.COMPLETED,
    });
    prisma.sceneVisual.update.mockResolvedValue({
      id: 'vis-1',
      sceneId: 'scene-1',
      isSelected: true,
      generatedImageMedia: null,
    });

    await service.updateSceneVisual('user-1', 'scene-1', 'vis-1', {
      isSelected: true,
    });

    expect(prisma.sceneVisual.updateMany).toHaveBeenCalledWith({
      where: { sceneId: 'scene-1', id: { not: 'vis-1' }, isSelected: true },
      data: { isSelected: false },
    });
  });

  it('restricts visual-generation job wrapper to visual job types', async () => {
    const { service, jobsService } = createService();
    jobsService.getById.mockResolvedValue({
      id: 'job-story',
      jobType: GenerationJobType.STORY,
    });

    await expect(service.getJob('user-1', 'job-story')).rejects.toThrow(
      NotFoundException,
    );
  });
});
