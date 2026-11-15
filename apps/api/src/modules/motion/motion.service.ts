import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerationJobType,
  JobStatus,
  MotionGenerationStatus,
  Prisma,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  estimateKlingVideoCostUsd,
  getKlingPricingFromEnv,
  JOB_TYPE_TO_QUEUE,
  type MotionJobAction,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { GenerateSceneMotionDto } from './dto/generate-scene-motion.dto';
import { GenerateStoryMotionDto } from './dto/generate-story-motion.dto';
import { UpdateMotionDto } from './dto/update-motion.dto';

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.QUEUED,
  JobStatus.PROCESSING,
];

const ACTIVE_MOTION_STATUSES: MotionGenerationStatus[] = [
  MotionGenerationStatus.PENDING,
  MotionGenerationStatus.ANALYZING,
  MotionGenerationStatus.SUBMITTING,
  MotionGenerationStatus.PROCESSING,
  MotionGenerationStatus.DOWNLOADING,
  MotionGenerationStatus.VALIDATING,
];

const MOTION_JOB_TYPES: GenerationJobType[] = [
  GenerationJobType.MOTION_ANALYSIS,
  GenerationJobType.VIDEO,
];

@Injectable()
export class MotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  async generateForStory(userId: string, storyId: string, dto: GenerateStoryMotionDto) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: {
        scenes: {
          orderBy: { sceneNumber: 'asc' },
          include: {
            visuals: {
              where: {
                generationStatus: VisualGenerationStatus.COMPLETED,
                generatedImageMediaId: { not: null },
              },
              orderBy: [{ isSelected: 'desc' }, { attemptNumber: 'desc' }],
            },
          },
        },
      },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (story.scenes.length === 0) {
      throw new BadRequestException('Story must have planned scenes before generating motion');
    }

    const requestedSceneIds = dto.sceneIds?.length ? [...new Set(dto.sceneIds)] : undefined;
    const targetScenes = requestedSceneIds
      ? story.scenes.filter((scene) => requestedSceneIds.includes(scene.id))
      : story.scenes;

    if (requestedSceneIds) {
      const validIds = new Set(story.scenes.map((scene) => scene.id));
      const invalid = requestedSceneIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException('One or more sceneIds do not belong to this story');
      }
    }

    const scenesWithoutImages = targetScenes.filter((scene) => scene.visuals.length === 0);
    if (scenesWithoutImages.length > 0) {
      throw new BadRequestException(
        `Scenes need a generated image before motion generation: ${scenesWithoutImages
          .map((scene) => scene.sceneNumber)
          .join(', ')}`,
      );
    }

    await this.assertNoActiveStoryMotionJobs(
      storyId,
      targetScenes.map((scene) => scene.id),
    );
    await this.assertBudgetAllows(
      userId,
      targetScenes.length,
      dto.durationSeconds ?? this.defaultDuration(),
      dto.resolution ?? this.defaultResolution(),
    );

    const createdMotions = [];
    for (const scene of targetScenes) {
      const sourceVisual = scene.visuals[0];
      if (!sourceVisual.generatedImageMediaId) {
        throw new BadRequestException(
          `Scene ${scene.sceneNumber} needs a generated image before motion generation`,
        );
      }
      await this.assertSceneAttemptLimits(scene.id);

      const latest = await this.prisma.motionGeneration.findFirst({
        where: { sceneId: scene.id },
        orderBy: { attemptNumber: 'desc' },
        select: { attemptNumber: true },
      });

      const durationSeconds = dto.durationSeconds ?? this.defaultDuration();
      const resolution = dto.resolution ?? this.defaultResolution();
      const estimatedCost = estimateKlingVideoCostUsd(
        durationSeconds,
        resolution,
        getKlingPricingFromEnv(),
      );

      const motion = await this.prisma.motionGeneration.create({
        data: {
          userId,
          storyId,
          sceneId: scene.id,
          sourceVisualId: sourceVisual.id,
          sourceMediaAssetId: sourceVisual.generatedImageMediaId,
          provider: 'kling',
          providerModel: this.config.get<string>('integrations.klingModel', 'kling-2.6'),
          motionPrompt: dto.motionPrompt?.trim() || scene.videoPrompt || 'Natural cinematic motion',
          negativePrompt: dto.negativePrompt,
          status: MotionGenerationStatus.PENDING,
          progress: 0,
          durationSeconds,
          resolution,
          estimatedCost: new Prisma.Decimal(estimatedCost),
          currency: this.config.get<string>('integrations.klingCurrency', 'USD'),
          attemptNumber: (latest?.attemptNumber ?? 0) + 1,
          generationParameters: {
            durationSeconds,
            resolution,
            skipAnalysis: dto.skipAnalysis === true,
          },
        },
      });
      createdMotions.push(motion);
    }

    const action: MotionJobAction = 'analyze_story_motion';
    const payload: Record<string, unknown> = {
      action,
      motionGenerationIds: createdMotions.map((motion) => motion.id),
      ...(dto.motionPrompt ? { motionPrompt: dto.motionPrompt } : {}),
      ...(dto.negativePrompt ? { negativePrompt: dto.negativePrompt } : {}),
      ...(dto.skipAnalysis !== undefined ? { skipAnalysis: dto.skipAnalysis } : {}),
      ...(dto.simulateFailure ? { simulateFailure: true } : {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId,
        jobType: GenerationJobType.MOTION_ANALYSIS,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName: JOB_TYPE_TO_QUEUE.MOTION_ANALYSIS,
        maxAttempts: dto.simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
        estimatedCost: new Prisma.Decimal(
          createdMotions.reduce(
            (sum, motion) => sum + Number(motion.estimatedCost ?? 0),
            0,
          ),
        ),
      },
    });

    await this.prisma.motionGeneration.updateMany({
      where: { id: { in: createdMotions.map((motion) => motion.id) } },
      data: { generationJobId: job.id },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'MOTION_ANALYSIS',
        {
          generationJobId: job.id,
          userId,
          storyId,
          jobType: 'MOTION_ANALYSIS',
          provider: 'gemini',
          payload,
          simulateFailure: dto.simulateFailure === true,
          useMockAi: this.shouldUseMockAi(),
        },
        { attempts: dto.simulateFailure ? 1 : 3 },
      );

      const queuedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJob.id,
        },
      });

      return {
        job: this.serializeJob(queuedJob),
        storyId,
        motionGenerations: createdMotions.map((motion) => this.serializeMotion(motion)),
      };
    } catch (error) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      await this.prisma.motionGeneration.updateMany({
        where: { id: { in: createdMotions.map((motion) => motion.id) } },
        data: {
          status: MotionGenerationStatus.FAILED,
          errorMessage: (error as Error).message,
          errorCode: 'ENQUEUE_FAILED',
        },
      });
      throw error;
    }
  }

  async generateForScene(
    userId: string,
    sceneId: string,
    dto: GenerateSceneMotionDto,
    options?: { regenerate?: boolean },
  ) {
    const scene = await this.ensureSceneOwned(userId, sceneId);
    const sourceVisual = await this.resolveSourceVisual(scene.id, dto.sourceVisualId);

    await this.assertNoActiveSceneMotionJobs(scene.id);
    await this.assertSceneAttemptLimits(scene.id);
    await this.assertBudgetAllows(
      userId,
      1,
      dto.durationSeconds ?? this.defaultDuration(),
      dto.resolution ?? this.defaultResolution(),
    );

    const latest = await this.prisma.motionGeneration.findFirst({
      where: { sceneId: scene.id },
      orderBy: { attemptNumber: 'desc' },
      select: { attemptNumber: true },
    });

    const durationSeconds = dto.durationSeconds ?? this.defaultDuration();
    const resolution = dto.resolution ?? this.defaultResolution();
    const estimatedCost = estimateKlingVideoCostUsd(
      durationSeconds,
      resolution,
      getKlingPricingFromEnv(),
    );

    const motion = await this.prisma.motionGeneration.create({
      data: {
        userId,
        storyId: scene.storyId,
        sceneId: scene.id,
        sourceVisualId: sourceVisual.id,
        sourceMediaAssetId: sourceVisual.generatedImageMediaId!,
        provider: 'kling',
        providerModel: this.config.get<string>('integrations.klingModel', 'kling-2.6'),
        motionPrompt:
          dto.motionPrompt?.trim() || scene.videoPrompt || 'Natural cinematic motion',
        negativePrompt: dto.negativePrompt,
        status: MotionGenerationStatus.PENDING,
        progress: 0,
        durationSeconds,
        resolution,
        estimatedCost: new Prisma.Decimal(estimatedCost),
        currency: this.config.get<string>('integrations.klingCurrency', 'USD'),
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        generationParameters: {
          durationSeconds,
          resolution,
          regenerate: options?.regenerate === true,
          skipAnalysis: dto.skipAnalysis === true || Boolean(dto.motionPrompt),
        },
      },
    });

    const action: MotionJobAction = options?.regenerate
      ? 'regenerate_scene_motion'
      : 'analyze_scene_motion';
    const payload: Record<string, unknown> = {
      action,
      motionGenerationId: motion.id,
      motionGenerationIds: [motion.id],
      sceneId: scene.id,
      ...(dto.motionPrompt ? { motionPrompt: dto.motionPrompt } : {}),
      ...(dto.negativePrompt ? { negativePrompt: dto.negativePrompt } : {}),
      skipAnalysis: dto.skipAnalysis === true || Boolean(dto.motionPrompt),
      ...(dto.simulateFailure ? { simulateFailure: true } : {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId: scene.storyId,
        jobType: GenerationJobType.MOTION_ANALYSIS,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName: JOB_TYPE_TO_QUEUE.MOTION_ANALYSIS,
        maxAttempts: dto.simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
        estimatedCost: new Prisma.Decimal(estimatedCost),
      },
    });

    await this.prisma.motionGeneration.update({
      where: { id: motion.id },
      data: { generationJobId: job.id },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'MOTION_ANALYSIS',
        {
          generationJobId: job.id,
          userId,
          storyId: scene.storyId,
          sceneId: scene.id,
          sceneVisualId: sourceVisual.id,
          motionGenerationId: motion.id,
          jobType: 'MOTION_ANALYSIS',
          provider: 'gemini',
          payload,
          simulateFailure: dto.simulateFailure === true,
          useMockAi: this.shouldUseMockAi(),
        },
        { attempts: dto.simulateFailure ? 1 : 3 },
      );

      const queuedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJob.id,
        },
      });

      return {
        job: this.serializeJob(queuedJob),
        motion: this.serializeMotion({ ...motion, generationJobId: job.id }),
      };
    } catch (error) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      await this.prisma.motionGeneration.update({
        where: { id: motion.id },
        data: {
          status: MotionGenerationStatus.FAILED,
          errorMessage: (error as Error).message,
          errorCode: 'ENQUEUE_FAILED',
        },
      });
      throw error;
    }
  }

  async regenerateForScene(userId: string, sceneId: string, dto: GenerateSceneMotionDto) {
    return this.generateForScene(userId, sceneId, dto, { regenerate: true });
  }

  async listStoryMotion(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: {
        scenes: {
          orderBy: { sceneNumber: 'asc' },
          include: {
            visuals: {
              orderBy: [{ isSelected: 'desc' }, { attemptNumber: 'desc' }],
              include: { generatedImageMedia: true },
            },
            motionGenerations: {
              orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
              include: {
                outputMediaAsset: true,
                sourceMediaAsset: true,
                generationJob: true,
              },
            },
          },
        },
      },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const jobs = await this.prisma.generationJob.findMany({
      where: {
        storyId,
        jobType: { in: MOTION_JOB_TYPES },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const scenes = await Promise.all(
      story.scenes.map(async (scene) => {
        const selectedVisual =
          scene.visuals.find((visual) => visual.isSelected && visual.generatedImageMedia) ||
          scene.visuals.find((visual) => visual.generatedImageMedia) ||
          null;

        return {
          id: scene.id,
          sceneNumber: scene.sceneNumber,
          durationSeconds: scene.durationSeconds,
          narration: scene.narration,
          visualDescription: scene.visualDescription,
          videoPrompt: scene.videoPrompt,
          cameraMovement: scene.cameraMovement,
          hasSourceImage: Boolean(selectedVisual?.generatedImageMediaId),
          sourceImageUrl: selectedVisual?.generatedImageMedia
            ? await this.storage.getPresignedDownloadUrl(
                selectedVisual.generatedImageMedia.storageKey,
                3600,
              )
            : null,
          motions: await Promise.all(
            scene.motionGenerations.map(async (motion) => this.serializeMotionDetailed(motion)),
          ),
        };
      }),
    );

    return {
      storyId,
      scenes,
      jobs: jobs.map((job) => this.serializeJob(job)),
    };
  }

  async listSceneMotion(userId: string, sceneId: string) {
    const scene = await this.ensureSceneOwned(userId, sceneId);
    const motions = await this.prisma.motionGeneration.findMany({
      where: { sceneId: scene.id },
      orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
      include: {
        outputMediaAsset: true,
        sourceMediaAsset: true,
        generationJob: true,
      },
    });
    return Promise.all(motions.map((motion) => this.serializeMotionDetailed(motion)));
  }

  async getMotion(userId: string, motionId: string) {
    const motion = await this.prisma.motionGeneration.findFirst({
      where: { id: motionId, userId },
      include: {
        outputMediaAsset: true,
        sourceMediaAsset: true,
        generationJob: true,
        scene: true,
      },
    });
    if (!motion) {
      throw new NotFoundException('Motion generation not found');
    }
    return this.serializeMotionDetailed(motion);
  }

  async updateMotion(userId: string, motionId: string, dto: UpdateMotionDto) {
    const motion = await this.prisma.motionGeneration.findFirst({
      where: { id: motionId, userId },
    });
    if (!motion) {
      throw new NotFoundException('Motion generation not found');
    }

    if (
      (dto.motionPrompt !== undefined || dto.negativePrompt !== undefined) &&
      ACTIVE_MOTION_STATUSES.includes(motion.status) &&
      motion.status !== MotionGenerationStatus.PENDING
    ) {
      throw new ConflictException('Cannot edit motion prompt while generation is in progress');
    }

    if (dto.isSelected === true) {
      await this.prisma.$transaction(async (tx) => {
        await tx.motionGeneration.updateMany({
          where: { sceneId: motion.sceneId, isSelected: true },
          data: { isSelected: false },
        });
        await tx.motionGeneration.update({
          where: { id: motion.id },
          data: {
            isSelected: true,
            ...(dto.motionPrompt !== undefined ? { motionPrompt: dto.motionPrompt } : {}),
            ...(dto.negativePrompt !== undefined ? { negativePrompt: dto.negativePrompt } : {}),
          },
        });
      });
    } else {
      await this.prisma.motionGeneration.update({
        where: { id: motion.id },
        data: {
          ...(dto.motionPrompt !== undefined ? { motionPrompt: dto.motionPrompt } : {}),
          ...(dto.negativePrompt !== undefined ? { negativePrompt: dto.negativePrompt } : {}),
          ...(dto.isSelected !== undefined ? { isSelected: dto.isSelected } : {}),
        },
      });
    }

    return this.getMotion(userId, motionId);
  }

  async selectMotion(userId: string, motionId: string) {
    return this.updateMotion(userId, motionId, { isSelected: true });
  }

  async getProgress(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: {
        scenes: { select: { id: true } },
      },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const motions = await this.prisma.motionGeneration.findMany({
      where: { storyId },
      select: {
        id: true,
        sceneId: true,
        status: true,
        progress: true,
        isSelected: true,
        attemptNumber: true,
        errorMessage: true,
        updatedAt: true,
      },
    });

    const countsByStatus = {
      PENDING: 0,
      ANALYZING: 0,
      SUBMITTING: 0,
      PROCESSING: 0,
      DOWNLOADING: 0,
      VALIDATING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };
    for (const motion of motions) {
      countsByStatus[motion.status] += 1;
    }

    const completedScenes = new Set(
      motions
        .filter((motion) => motion.status === MotionGenerationStatus.COMPLETED)
        .map((motion) => motion.sceneId),
    ).size;
    const failedScenes = new Set(
      motions
        .filter((motion) => motion.status === MotionGenerationStatus.FAILED)
        .map((motion) => motion.sceneId),
    ).size;

    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        storyId,
        jobType: { in: MOTION_JOB_TYPES },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const totalScenes = story.scenes.length;
    const percentComplete =
      totalScenes === 0 ? 0 : Math.round((completedScenes / totalScenes) * 100);

    return {
      storyId,
      totalScenes,
      completedScenes,
      failedScenes,
      percentComplete,
      countsByStatus,
      activeJobs: activeJobs.map((job) => this.serializeJob(job)),
      motions: motions.map((motion) => ({
        id: motion.id,
        sceneId: motion.sceneId,
        status: motion.status,
        progress: motion.progress,
        isSelected: motion.isSelected,
        attemptNumber: motion.attemptNumber,
        errorMessage: motion.errorMessage,
        updatedAt: motion.updatedAt,
      })),
    };
  }

  async retryMotion(userId: string, motionId: string) {
    const motion = await this.prisma.motionGeneration.findFirst({
      where: { id: motionId, userId },
      include: { generationJob: true },
    });
    if (!motion) {
      throw new NotFoundException('Motion generation not found');
    }
    if (
      motion.status !== MotionGenerationStatus.FAILED &&
      motion.status !== MotionGenerationStatus.CANCELLED
    ) {
      throw new ConflictException('Only failed or cancelled motion generations can be retried');
    }

    // Retry by creating a fresh attempt from the same source visual.
    return this.generateForScene(userId, motion.sceneId, {
      durationSeconds: motion.durationSeconds as 5 | 10,
      resolution: motion.resolution as '720p' | '1080p',
      motionPrompt: motion.motionPrompt,
      negativePrompt: motion.negativePrompt ?? undefined,
      sourceVisualId: motion.sourceVisualId,
      skipAnalysis: true,
    }, { regenerate: true });
  }

  async cancelMotion(userId: string, motionId: string) {
    const motion = await this.prisma.motionGeneration.findFirst({
      where: { id: motionId, userId },
    });
    if (!motion) {
      throw new NotFoundException('Motion generation not found');
    }

    if (!ACTIVE_MOTION_STATUSES.includes(motion.status)) {
      throw new ConflictException('Only pending/in-progress motion jobs can be cancelled');
    }

    // Provider cancel is not documented for Kling image-to-video; cancel local tracking.
    if (motion.generationJobId) {
      try {
        await this.jobsService.cancel(userId, motion.generationJobId);
      } catch {
        // Job may already be past cancellable Bull states; still mark motion cancelled.
      }
    }

    const updated = await this.prisma.motionGeneration.update({
      where: { id: motion.id },
      data: {
        status: MotionGenerationStatus.CANCELLED,
        errorMessage: 'Cancelled by user',
        completedAt: new Date(),
      },
      include: {
        outputMediaAsset: true,
        sourceMediaAsset: true,
        generationJob: true,
      },
    });

    return this.serializeMotionDetailed(updated);
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.jobsService.getById(userId, jobId);
    if (!MOTION_JOB_TYPES.includes(job.jobType)) {
      throw new NotFoundException('Motion job not found');
    }
    return job;
  }

  async retryJob(userId: string, jobId: string) {
    await this.getJob(userId, jobId);
    return this.jobsService.retry(userId, jobId);
  }

  async cancelJob(userId: string, jobId: string) {
    await this.getJob(userId, jobId);
    return this.jobsService.cancel(userId, jobId);
  }

  private async resolveSourceVisual(sceneId: string, sourceVisualId?: string) {
    if (sourceVisualId) {
      const visual = await this.prisma.sceneVisual.findFirst({
        where: {
          id: sourceVisualId,
          sceneId,
          generationStatus: VisualGenerationStatus.COMPLETED,
          generatedImageMediaId: { not: null },
        },
      });
      if (!visual) {
        throw new BadRequestException(
          'sourceVisualId must reference a completed generated image for this scene',
        );
      }
      return visual;
    }

    const visual = await this.prisma.sceneVisual.findFirst({
      where: {
        sceneId,
        generationStatus: VisualGenerationStatus.COMPLETED,
        generatedImageMediaId: { not: null },
      },
      orderBy: [{ isSelected: 'desc' }, { attemptNumber: 'desc' }],
    });
    if (!visual) {
      throw new BadRequestException(
        'Scene needs a successfully generated image before motion generation',
      );
    }
    return visual;
  }

  private async ensureSceneOwned(userId: string, sceneId: string) {
    const scene = await this.prisma.storyScene.findFirst({
      where: { id: sceneId, story: { userId } },
    });
    if (!scene) {
      throw new NotFoundException('Scene not found');
    }
    return scene;
  }

  private async assertNoActiveStoryMotionJobs(storyId: string, sceneIds: string[]) {
    const active = await this.prisma.motionGeneration.findFirst({
      where: {
        storyId,
        sceneId: { in: sceneIds },
        status: { in: ACTIVE_MOTION_STATUSES },
      },
      select: { id: true, sceneId: true, status: true },
    });
    if (active) {
      throw new ConflictException(
        'Motion generation is already in progress for one or more selected scenes',
      );
    }
  }

  private async assertNoActiveSceneMotionJobs(sceneId: string) {
    const active = await this.prisma.motionGeneration.findFirst({
      where: {
        sceneId,
        status: { in: ACTIVE_MOTION_STATUSES },
      },
    });
    if (active) {
      throw new ConflictException('Motion generation is already in progress for this scene');
    }
  }

  private async assertSceneAttemptLimits(sceneId: string) {
    const maxClips = this.config.get<number>('integrations.klingMaxClipsPerScene', 10);
    const maxAttempts = this.config.get<number>('integrations.klingMaxAttemptsPerScene', 20);
    const total = await this.prisma.motionGeneration.count({ where: { sceneId } });
    if (total >= maxAttempts) {
      throw new BadRequestException(
        `Maximum motion generation attempts per scene (${maxAttempts}) reached`,
      );
    }
    const completed = await this.prisma.motionGeneration.count({
      where: { sceneId, status: MotionGenerationStatus.COMPLETED },
    });
    if (completed >= maxClips) {
      throw new BadRequestException(
        `Maximum completed clips per scene (${maxClips}) reached`,
      );
    }
  }

  private async assertBudgetAllows(
    userId: string,
    clipCount: number,
    durationSeconds: number,
    resolution: string,
  ) {
    const maxMonthly = this.config.get<string>('integrations.klingMaxMonthlySpendUsd');
    if (!maxMonthly) return;

    const limit = Number.parseFloat(maxMonthly);
    if (!Number.isFinite(limit) || limit <= 0) return;

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const usages = await this.prisma.providerUsage.findMany({
      where: {
        userId,
        provider: 'kling',
        createdAt: { gte: startOfMonth },
      },
      select: { estimatedCost: true },
    });
    const spent = usages.reduce((sum, row) => sum + Number(row.estimatedCost), 0);
    const upcoming = estimateKlingVideoCostUsd(durationSeconds, resolution) * clipCount;
    if (spent + upcoming > limit) {
      throw new BadRequestException(
        `Monthly Kling motion budget of $${limit} would be exceeded (spent $${spent.toFixed(4)}, requested ~$${upcoming.toFixed(4)})`,
      );
    }
  }

  private defaultDuration(): 5 | 10 {
    const value = this.config.get<number>('integrations.klingDefaultDurationSeconds', 5);
    return value === 10 ? 10 : 5;
  }

  private defaultResolution(): '720p' | '1080p' {
    const value = this.config.get<string>('integrations.klingDefaultResolution', '720p');
    return value === '1080p' ? '1080p' : '720p';
  }

  private shouldUseMockAi(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      this.config.get<string>('integrations.klingUseMock') === 'true' ||
      this.config.get<string>('integrations.geminiUseMock') === 'true' ||
      process.env.KLING_USE_MOCK === 'true' ||
      process.env.GEMINI_USE_MOCK === 'true'
    );
  }

  private serializeJob(job: {
    id: string;
    status: JobStatus;
    progress: number;
    jobType: GenerationJobType;
    errorMessage?: string | null;
    updatedAt?: Date;
    createdAt?: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      jobType: job.jobType,
      errorMessage: job.errorMessage ?? null,
      updatedAt: job.updatedAt,
      createdAt: job.createdAt,
    };
  }

  private serializeMotion(motion: {
    id: string;
    sceneId: string;
    storyId: string;
    status: MotionGenerationStatus;
    progress: number;
    motionPrompt: string;
    negativePrompt?: string | null;
    durationSeconds: number;
    resolution: string;
    isSelected: boolean;
    attemptNumber: number;
    provider?: string | null;
    providerModel?: string | null;
    providerTaskId?: string | null;
    estimatedCost?: Prisma.Decimal | null;
    actualCost?: Prisma.Decimal | null;
    currency?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    generationJobId?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
    completedAt?: Date | null;
  }) {
    return {
      id: motion.id,
      sceneId: motion.sceneId,
      storyId: motion.storyId,
      status: motion.status,
      progress: motion.progress,
      motionPrompt: motion.motionPrompt,
      negativePrompt: motion.negativePrompt ?? null,
      durationSeconds: motion.durationSeconds,
      resolution: motion.resolution,
      isSelected: motion.isSelected,
      attemptNumber: motion.attemptNumber,
      provider: motion.provider ?? null,
      providerModel: motion.providerModel ?? null,
      providerTaskId: motion.providerTaskId ?? null,
      estimatedCost: motion.estimatedCost != null ? Number(motion.estimatedCost) : null,
      actualCost: motion.actualCost != null ? Number(motion.actualCost) : null,
      currency: motion.currency ?? 'USD',
      errorCode: motion.errorCode ?? null,
      errorMessage: motion.errorMessage ?? null,
      generationJobId: motion.generationJobId ?? null,
      createdAt: motion.createdAt,
      updatedAt: motion.updatedAt,
      completedAt: motion.completedAt ?? null,
    };
  }

  private async serializeMotionDetailed(motion: {
    id: string;
    sceneId: string;
    storyId: string;
    status: MotionGenerationStatus;
    progress: number;
    motionPrompt: string;
    negativePrompt?: string | null;
    durationSeconds: number;
    resolution: string;
    isSelected: boolean;
    attemptNumber: number;
    provider?: string | null;
    providerModel?: string | null;
    providerTaskId?: string | null;
    estimatedCost?: Prisma.Decimal | null;
    actualCost?: Prisma.Decimal | null;
    currency?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    generationJobId?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
    completedAt?: Date | null;
    structuredBrief?: Prisma.JsonValue | null;
    generationParameters?: Prisma.JsonValue | null;
    outputMediaAsset?: { storageKey: string; mimeType: string | null; metadata: Prisma.JsonValue | null } | null;
    sourceMediaAsset?: { storageKey: string; mimeType: string | null } | null;
    generationJob?: {
      id: string;
      status: JobStatus;
      progress: number;
      jobType: GenerationJobType;
      errorMessage: string | null;
      updatedAt: Date;
      createdAt: Date;
    } | null;
  }) {
    return {
      ...this.serializeMotion(motion),
      structuredBrief: motion.structuredBrief ?? null,
      generationParameters: motion.generationParameters ?? null,
      downloadUrl: motion.outputMediaAsset
        ? await this.storage.getPresignedDownloadUrl(motion.outputMediaAsset.storageKey, 3600)
        : null,
      sourceImageUrl: motion.sourceMediaAsset
        ? await this.storage.getPresignedDownloadUrl(motion.sourceMediaAsset.storageKey, 3600)
        : null,
      outputMetadata: motion.outputMediaAsset?.metadata ?? null,
      generationJob: motion.generationJob
        ? this.serializeJob(motion.generationJob)
        : null,
    };
  }
}
