import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GenerationJobType,
  JobStatus,
  Prisma,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  JOB_TYPE_TO_QUEUE,
  type VisualJobAction,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { VisualStylesService } from '../visual-styles/visual-styles.service';
import { GenerateCharacterReferenceDto } from './dto/generate-character-reference.dto';
import { GenerateSceneVisualDto } from './dto/generate-scene-visual.dto';
import { GenerateStoryVisualsDto } from './dto/generate-story-visuals.dto';
import { UpdateSceneVisualDto } from './dto/update-scene-visual.dto';

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.QUEUED,
  JobStatus.PROCESSING,
];

const VISUAL_JOB_TYPES: GenerationJobType[] = [
  GenerationJobType.VISUAL_ANALYSIS,
  GenerationJobType.CHARACTER_REFERENCE,
  GenerationJobType.IMAGE,
];

@Injectable()
export class VisualsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
    private readonly visualStylesService: VisualStylesService,
    private readonly jobsService: JobsService,
  ) {}

  async generateForStory(
    userId: string,
    storyId: string,
    dto: GenerateStoryVisualsDto,
  ) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: {
        scenes: {
          orderBy: { sceneNumber: 'asc' },
          select: { id: true, sceneNumber: true },
        },
      },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (story.scenes.length === 0) {
      throw new BadRequestException(
        'Story must have planned scenes before generating visuals',
      );
    }

    const requestedSceneIds = dto.sceneIds?.length
      ? [...new Set(dto.sceneIds)]
      : undefined;

    if (requestedSceneIds) {
      const validIds = new Set(story.scenes.map((scene) => scene.id));
      const invalid = requestedSceneIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException(
          'One or more sceneIds do not belong to this story',
        );
      }
    }

    let resolvedVisualStyleId = story.visualStyleId;
    if (dto.visualStyleId) {
      await this.visualStylesService.ensureAccessible(userId, dto.visualStyleId);
      await this.prisma.story.update({
        where: { id: storyId },
        data: { visualStyleId: dto.visualStyleId },
      });
      resolvedVisualStyleId = dto.visualStyleId;
    } else if (!resolvedVisualStyleId) {
      const defaultStyle = await this.visualStylesService.getDefault();
      resolvedVisualStyleId = defaultStyle.id;
    }

    await this.assertNoActiveStoryVisualJobs(storyId, requestedSceneIds);

    const action: VisualJobAction = 'analyze_story_visuals';
    const payload: Record<string, unknown> = {
      action,
      visualStyleId: resolvedVisualStyleId,
      ...(requestedSceneIds ? { sceneIds: requestedSceneIds } : {}),
      ...(dto.skipCharacterReferences !== undefined
        ? { skipCharacterReferences: dto.skipCharacterReferences }
        : {}),
      ...(dto.regeneratePrompts !== undefined
        ? { regeneratePrompts: dto.regeneratePrompts }
        : {}),
      ...(dto.simulateFailure ? { simulateFailure: true } : {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId,
        jobType: GenerationJobType.VISUAL_ANALYSIS,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName: JOB_TYPE_TO_QUEUE.VISUAL_ANALYSIS,
        maxAttempts: dto.simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'VISUAL_ANALYSIS',
        {
          generationJobId: job.id,
          userId,
          storyId,
          jobType: 'VISUAL_ANALYSIS',
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
      throw error;
    }
  }

  async listStoryVisuals(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: {
        visualStyle: true,
        scenes: {
          orderBy: { sceneNumber: 'asc' },
          include: {
            visuals: {
              orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
              include: {
                generatedImageMedia: true,
                visualStyle: true,
                generationJob: {
                  select: {
                    id: true,
                    status: true,
                    progress: true,
                    jobType: true,
                    errorMessage: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        },
        characters: {
          orderBy: { name: 'asc' },
          include: {
            visualReferences: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
              include: {
                mediaAsset: true,
                generationJob: {
                  select: {
                    id: true,
                    status: true,
                    progress: true,
                    jobType: true,
                    errorMessage: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        },
        generationJobs: {
          where: { jobType: { in: VISUAL_JOB_TYPES } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const scenes = await Promise.all(
      story.scenes.map(async (scene) => ({
        ...scene,
        visuals: await Promise.all(
          scene.visuals.map((visual) => this.serializeSceneVisual(visual)),
        ),
      })),
    );

    const characters = await Promise.all(
      story.characters.map(async (character) => ({
        ...character,
        visualReferences: await Promise.all(
          character.visualReferences.map((ref) =>
            this.serializeCharacterReference(ref),
          ),
        ),
      })),
    );

    return {
      storyId: story.id,
      visualStyle: story.visualStyle,
      scenes,
      characters,
      jobs: story.generationJobs.map((job) => this.serializeJob(job)),
    };
  }

  async getProgress(userId: string, storyId: string) {
    await this.ensureStoryOwned(userId, storyId);

    const [scenes, characters, activeJobs] = await Promise.all([
      this.prisma.storyScene.findMany({
        where: { storyId },
        orderBy: { sceneNumber: 'asc' },
        select: {
          id: true,
          visuals: {
            orderBy: [
              { isSelected: 'desc' },
              { attemptNumber: 'desc' },
              { createdAt: 'desc' },
            ],
            select: {
              id: true,
              generationStatus: true,
              isSelected: true,
            },
          },
        },
      }),
      this.prisma.characterProfile.findMany({
        where: { storyId },
        select: {
          id: true,
          _count: { select: { visualReferences: true } },
        },
      }),
      this.prisma.generationJob.findMany({
        where: {
          storyId,
          jobType: { in: VISUAL_JOB_TYPES },
          status: { in: ACTIVE_JOB_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const countsByStatus: Record<VisualGenerationStatus, number> = {
      PENDING: 0,
      ANALYZING: 0,
      PROMPT_READY: 0,
      GENERATING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    for (const scene of scenes) {
      const representative =
        scene.visuals.find((visual) => visual.isSelected) ?? scene.visuals[0];
      const status =
        representative?.generationStatus ?? VisualGenerationStatus.PENDING;
      countsByStatus[status] += 1;
    }

    const totalScenes = scenes.length;
    const completedScenes = countsByStatus.COMPLETED;
    const percentComplete =
      totalScenes === 0 ? 0 : Math.round((completedScenes / totalScenes) * 100);

    const charactersTotal = characters.length;
    const charactersWithReferences = characters.filter(
      (c) => c._count.visualReferences > 0,
    ).length;

    return {
      storyId,
      totalScenes,
      completedScenes,
      failedScenes: countsByStatus.FAILED,
      percentComplete,
      countsByStatus,
      activeJobs: activeJobs.map((job) => this.serializeJob(job)),
      charactersTotal,
      charactersWithReferences,
    };
  }

  async generateForScene(
    userId: string,
    sceneId: string,
    dto: GenerateSceneVisualDto,
  ) {
    return this.enqueueSceneImageGeneration(userId, sceneId, dto, false);
  }

  async regenerateForScene(
    userId: string,
    sceneId: string,
    dto: GenerateSceneVisualDto,
  ) {
    return this.enqueueSceneImageGeneration(userId, sceneId, dto, true);
  }

  async listSceneVisuals(userId: string, sceneId: string) {
    const scene = await this.prisma.storyScene.findFirst({
      where: { id: sceneId, story: { userId } },
      select: { id: true },
    });
    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    const visuals = await this.prisma.sceneVisual.findMany({
      where: { sceneId },
      orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
      include: {
        generatedImageMedia: true,
        visualStyle: true,
        generationJob: {
          select: {
            id: true,
            status: true,
            progress: true,
            jobType: true,
            errorMessage: true,
            updatedAt: true,
          },
        },
      },
    });

    return Promise.all(visuals.map((visual) => this.serializeSceneVisual(visual)));
  }

  async updateSceneVisual(
    userId: string,
    sceneId: string,
    visualId: string,
    dto: UpdateSceneVisualDto,
  ) {
    const existing = await this.prisma.sceneVisual.findFirst({
      where: {
        id: visualId,
        sceneId,
        scene: { story: { userId } },
      },
    });
    if (!existing) {
      throw new NotFoundException('Scene visual not found');
    }

    const isEditingPrompt =
      dto.visualPrompt !== undefined || dto.negativePrompt !== undefined;
    if (
      isEditingPrompt &&
      (existing.generationStatus === VisualGenerationStatus.GENERATING ||
        existing.generationStatus === VisualGenerationStatus.ANALYZING)
    ) {
      throw new ConflictException(
        'Cannot edit prompts while visual generation is in progress',
      );
    }

    const nextPrompt =
      dto.visualPrompt !== undefined ? dto.visualPrompt.trim() : undefined;
    const nextNegativePrompt =
      dto.negativePrompt !== undefined ? dto.negativePrompt.trim() : undefined;

    const statusUpdate =
      nextPrompt !== undefined &&
      existing.generationStatus === VisualGenerationStatus.PENDING
        ? { generationStatus: VisualGenerationStatus.PROMPT_READY }
        : {};

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isSelected === true) {
        await tx.sceneVisual.updateMany({
          where: { sceneId, id: { not: visualId }, isSelected: true },
          data: { isSelected: false },
        });
      }

      return tx.sceneVisual.update({
        where: { id: visualId },
        data: {
          ...(nextPrompt !== undefined ? { visualPrompt: nextPrompt } : {}),
          ...(nextNegativePrompt !== undefined
            ? { negativePrompt: nextNegativePrompt }
            : {}),
          ...(dto.isSelected !== undefined ? { isSelected: dto.isSelected } : {}),
          ...statusUpdate,
        },
        include: {
          generatedImageMedia: true,
          visualStyle: true,
          generationJob: {
            select: {
              id: true,
              status: true,
              progress: true,
              jobType: true,
              errorMessage: true,
              updatedAt: true,
            },
          },
        },
      });
    });

    return this.serializeSceneVisual(updated);
  }

  async generateCharacterReference(
    userId: string,
    characterId: string,
    dto: GenerateCharacterReferenceDto,
  ) {
    const character = await this.prisma.characterProfile.findFirst({
      where: { id: characterId, story: { userId } },
      include: {
        story: { select: { id: true, visualStyleId: true } },
      },
    });
    if (!character) {
      throw new NotFoundException('Character not found');
    }

    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        storyId: character.storyId,
        jobType: {
          in: [
            GenerationJobType.VISUAL_ANALYSIS,
            GenerationJobType.CHARACTER_REFERENCE,
          ],
        },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true, jobType: true, status: true, payload: true },
    });

    const blockingJob = activeJobs.find((job) => {
      if (job.jobType === GenerationJobType.VISUAL_ANALYSIS) {
        return true;
      }
      const payload = this.asRecord(job.payload);
      return (
        payload.characterProfileId === characterId ||
        payload.characterId === characterId
      );
    });

    if (blockingJob) {
      throw new ConflictException(
        `A ${blockingJob.jobType} job is already ${blockingJob.status} for this character`,
      );
    }

    const visualStyleId =
      character.story.visualStyleId ??
      (await this.visualStylesService.getDefault()).id;

    const action: VisualJobAction = 'generate_character_reference';
    const payload: Record<string, unknown> = {
      action,
      characterProfileId: character.id,
      visualStyleId,
      force: Boolean(dto.force),
      ...(dto.simulateFailure ? { simulateFailure: true } : {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId: character.storyId,
        jobType: GenerationJobType.CHARACTER_REFERENCE,
        status: JobStatus.PENDING,
        provider: 'fal',
        queueName: JOB_TYPE_TO_QUEUE.CHARACTER_REFERENCE,
        maxAttempts: dto.simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'CHARACTER_REFERENCE',
        {
          generationJobId: job.id,
          userId,
          storyId: character.storyId,
          characterProfileId: character.id,
          jobType: 'CHARACTER_REFERENCE',
          provider: 'fal',
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
        characterId: character.id,
        storyId: character.storyId,
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
      throw error;
    }
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.jobsService.getById(userId, jobId);
    if (!VISUAL_JOB_TYPES.includes(job.jobType)) {
      throw new NotFoundException('Visual generation job not found');
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

  private async enqueueSceneImageGeneration(
    userId: string,
    sceneId: string,
    dto: GenerateSceneVisualDto,
    isRegenerate: boolean,
  ) {
    const scene = await this.prisma.storyScene.findFirst({
      where: { id: sceneId, story: { userId } },
      include: {
        story: { select: { id: true, visualStyleId: true } },
        visuals: {
          orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
          include: {
            generationJob: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!scene) {
      throw new NotFoundException('Scene not found');
    }

    await this.assertNoActiveSceneImageJob(scene.storyId, scene.id, scene.visuals);

    let visualStyleId = scene.story.visualStyleId;
    if (dto.visualStyleId) {
      await this.visualStylesService.ensureAccessible(userId, dto.visualStyleId);
      visualStyleId = dto.visualStyleId;
    } else if (!visualStyleId) {
      visualStyleId = (await this.visualStylesService.getDefault()).id;
    }

    const latestVisual = scene.visuals[0];
    const hasPromptOverride = Boolean(dto.visualPrompt?.trim());
    const initialStatus =
      hasPromptOverride && !dto.regeneratePrompt
        ? VisualGenerationStatus.PROMPT_READY
        : VisualGenerationStatus.PENDING;

    const visualPrompt =
      dto.visualPrompt?.trim() ||
      (!dto.regeneratePrompt ? latestVisual?.visualPrompt : undefined) ||
      scene.imagePrompt;
    const negativePrompt =
      dto.negativePrompt !== undefined
        ? dto.negativePrompt.trim()
        : latestVisual?.negativePrompt ?? null;
    const attemptNumber = (latestVisual?.attemptNumber ?? 0) + 1;

    const action: VisualJobAction = isRegenerate
      ? 'regenerate_scene_image'
      : 'generate_scene_image';

    const sceneVisual = await this.prisma.sceneVisual.create({
      data: {
        sceneId: scene.id,
        visualStyleId,
        visualPrompt,
        negativePrompt,
        generationStatus: initialStatus,
        isSelected: false,
        attemptNumber,
        provider: 'fal',
      },
    });

    const payload: Record<string, unknown> = {
      action,
      sceneId: scene.id,
      sceneVisualId: sceneVisual.id,
      visualStyleId,
      ...(hasPromptOverride ? { visualPrompt } : {}),
      ...(negativePrompt !== null ? { negativePrompt } : {}),
      ...(dto.regeneratePrompt !== undefined
        ? { regeneratePrompt: dto.regeneratePrompt }
        : {}),
      ...(dto.simulateFailure ? { simulateFailure: true } : {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId: scene.storyId,
        jobType: GenerationJobType.IMAGE,
        status: JobStatus.PENDING,
        provider: 'fal',
        queueName: JOB_TYPE_TO_QUEUE.IMAGE,
        maxAttempts: dto.simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    await this.prisma.sceneVisual.update({
      where: { id: sceneVisual.id },
      data: { generationJobId: job.id },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'IMAGE',
        {
          generationJobId: job.id,
          userId,
          storyId: scene.storyId,
          sceneId: scene.id,
          sceneVisualId: sceneVisual.id,
          jobType: 'IMAGE',
          provider: 'fal',
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

      const updatedVisual = await this.prisma.sceneVisual.findUniqueOrThrow({
        where: { id: sceneVisual.id },
        include: {
          generatedImageMedia: true,
          visualStyle: true,
          generationJob: {
            select: {
              id: true,
              status: true,
              progress: true,
              jobType: true,
              errorMessage: true,
              updatedAt: true,
            },
          },
        },
      });

      return {
        sceneVisual: await this.serializeSceneVisual(updatedVisual),
        job: this.serializeJob(queuedJob),
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
      await this.prisma.sceneVisual.update({
        where: { id: sceneVisual.id },
        data: {
          generationStatus: VisualGenerationStatus.FAILED,
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }
  }

  private async ensureStoryOwned(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return story;
  }

  private async assertNoActiveStoryVisualJobs(
    storyId: string,
    sceneIds?: string[],
  ) {
    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        storyId,
        jobType: { in: VISUAL_JOB_TYPES },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true, jobType: true, status: true, payload: true },
    });

    if (activeJobs.length > 0) {
      if (!sceneIds?.length) {
        const first = activeJobs[0]!;
        throw new ConflictException(
          `A ${first.jobType} job is already ${first.status} for this story`,
        );
      }

      const targetSet = new Set(sceneIds);
      const conflict = activeJobs.find((job) => {
        if (job.jobType !== GenerationJobType.IMAGE) {
          return true;
        }
        const payload = this.asRecord(job.payload);
        return typeof payload.sceneId === 'string' && targetSet.has(payload.sceneId);
      });
      if (conflict) {
        throw new ConflictException(
          `A ${conflict.jobType} job is already ${conflict.status}`,
        );
      }
    }

    if (sceneIds?.length) {
      const busyVisual = await this.prisma.sceneVisual.findFirst({
        where: {
          sceneId: { in: sceneIds },
          generationStatus: {
            in: [
              VisualGenerationStatus.ANALYZING,
              VisualGenerationStatus.GENERATING,
            ],
          },
          generationJob: { status: { in: ACTIVE_JOB_STATUSES } },
        },
        select: { id: true, sceneId: true },
      });
      if (busyVisual) {
        throw new ConflictException(
          'Visual generation is already in progress for one or more selected scenes',
        );
      }
    }
  }

  private async assertNoActiveSceneImageJob(
    storyId: string,
    sceneId: string,
    visuals: Array<{
      generationStatus: VisualGenerationStatus;
      generationJob: { id: string; status: JobStatus } | null;
    }>,
  ) {
    const busyVisual = visuals.find(
      (visual) =>
        (visual.generationStatus === VisualGenerationStatus.ANALYZING ||
          visual.generationStatus === VisualGenerationStatus.GENERATING) &&
        visual.generationJob &&
        ACTIVE_JOB_STATUSES.includes(visual.generationJob.status),
    );
    if (busyVisual) {
      throw new ConflictException(
        'Visual generation is already in progress for this scene',
      );
    }

    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        storyId,
        jobType: {
          in: [GenerationJobType.VISUAL_ANALYSIS, GenerationJobType.IMAGE],
        },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true, jobType: true, status: true, payload: true },
    });

    const conflict = activeJobs.find((job) => {
      if (job.jobType === GenerationJobType.VISUAL_ANALYSIS) {
        return true;
      }
      const payload = this.asRecord(job.payload);
      return payload.sceneId === sceneId;
    });

    if (conflict) {
      throw new ConflictException(
        `A ${conflict.jobType} job is already ${conflict.status} for this scene`,
      );
    }
  }

  private shouldUseMockAi(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.FAL_USE_MOCK === 'true' ||
      process.env.GEMINI_USE_MOCK === 'true'
    );
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private async safePresignedDownloadUrl(storageKey: string): Promise<string | null> {
    try {
      return await this.storage.getPresignedDownloadUrl(storageKey, 3600);
    } catch {
      return null;
    }
  }

  private async serializeMediaAsset(
    asset: {
      id: string;
      userId: string;
      videoProjectId: string | null;
      type: string;
      storageKey: string;
      originalName: string | null;
      mimeType: string | null;
      fileSize: bigint | null;
      metadata: Prisma.JsonValue;
      createdAt: Date;
    } | null,
  ) {
    if (!asset) {
      return null;
    }
    const downloadUrl = await this.safePresignedDownloadUrl(asset.storageKey);
    return {
      ...asset,
      fileSize: asset.fileSize !== null ? Number(asset.fileSize) : null,
      downloadUrl,
    };
  }

  private async serializeSceneVisual<
    T extends {
      generatedImageMedia?: {
        id: string;
        userId: string;
        videoProjectId: string | null;
        type: string;
        storageKey: string;
        originalName: string | null;
        mimeType: string | null;
        fileSize: bigint | null;
        metadata: Prisma.JsonValue;
        createdAt: Date;
      } | null;
    },
  >(visual: T) {
    const generatedImageMedia = await this.serializeMediaAsset(
      visual.generatedImageMedia ?? null,
    );
    return {
      ...visual,
      generatedImageMedia,
      downloadUrl: generatedImageMedia?.downloadUrl ?? null,
    };
  }

  private async serializeCharacterReference<
    T extends {
      mediaAsset?: {
        id: string;
        userId: string;
        videoProjectId: string | null;
        type: string;
        storageKey: string;
        originalName: string | null;
        mimeType: string | null;
        fileSize: bigint | null;
        metadata: Prisma.JsonValue;
        createdAt: Date;
      } | null;
    },
  >(reference: T) {
    const mediaAsset = await this.serializeMediaAsset(
      reference.mediaAsset ?? null,
    );
    return {
      ...reference,
      mediaAsset,
      downloadUrl: mediaAsset?.downloadUrl ?? null,
    };
  }

  private serializeJob(job: {
    id: string;
    userId: string;
    videoProjectId: string | null;
    storyId: string | null;
    jobType: GenerationJobType;
    status: JobStatus;
    progress: number;
    provider: string | null;
    queueName: string | null;
    queueJobId: string | null;
    attempts: number;
    maxAttempts: number;
    estimatedCost: Prisma.Decimal | null;
    actualCost: Prisma.Decimal | null;
    payload: Prisma.JsonValue;
    result: Prisma.JsonValue;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...job,
      estimatedCost: job.estimatedCost !== null ? Number(job.estimatedCost) : null,
      actualCost: job.actualCost !== null ? Number(job.actualCost) : null,
    };
  }
}
