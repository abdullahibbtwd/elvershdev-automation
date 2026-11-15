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
  ProjectStatus,
  StoryGenerationType,
  StoryStatus,
} from '@prisma/client';
import {
  JOB_TYPE_TO_QUEUE,
  storyBriefSchema,
  type GenerationJobTypeKey,
  type StoryBriefInput,
} from '@ai-video/shared';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { AttachStoryToProjectDto } from './dto/attach-project.dto';
import { CreateStoryDto } from './dto/create-story.dto';
import { GenerateStoryDto } from './dto/generate-story.dto';
import { ListStoriesDto } from './dto/list-stories.dto';
import { RegenerateStoryDto } from './dto/regenerate-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.QUEUED,
  JobStatus.PROCESSING,
];

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  async create(userId: string, dto: CreateStoryDto) {
    return this.prisma.story.create({
      data: {
        userId,
        title: dto.title.trim(),
        content: dto.content,
        status: dto.status ?? StoryStatus.DRAFT,
        topic: dto.topic,
        niche: dto.niche,
        targetAudience: dto.targetAudience,
        language: dto.language ?? 'en',
        tone: dto.tone,
        category: dto.category,
        targetDurationSeconds: dto.targetDurationSeconds,
        openingHook: dto.openingHook,
        narrationScript: dto.narrationScript,
        closingMessage: dto.closingMessage,
        description: dto.description,
      },
    });
  }

  async list(userId: string, query: ListStoriesDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.StoryWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { content: { contains: query.search, mode: 'insensitive' } },
              { topic: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.story.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { scenes: true, characters: true, generations: true } },
        },
      }),
      this.prisma.story.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async getById(userId: string, id: string) {
    const story = await this.prisma.story.findFirst({
      where: { id, userId },
      include: {
        scenes: { orderBy: { sceneNumber: 'asc' } },
        characters: { orderBy: { name: 'asc' } },
        generations: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
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
        generationJobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        videoProjects: {
          select: { id: true, title: true, status: true },
          take: 10,
        },
        providerUsages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return this.serializeStoryDetail(story);
  }

  async update(userId: string, id: string, dto: UpdateStoryDto) {
    await this.ensureOwned(userId, id);
    return this.prisma.story.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
        ...(dto.niche !== undefined ? { niche: dto.niche } : {}),
        ...(dto.targetAudience !== undefined ? { targetAudience: dto.targetAudience } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.targetDurationSeconds !== undefined
          ? { targetDurationSeconds: dto.targetDurationSeconds }
          : {}),
        ...(dto.openingHook !== undefined ? { openingHook: dto.openingHook } : {}),
        ...(dto.narrationScript !== undefined ? { narrationScript: dto.narrationScript } : {}),
        ...(dto.closingMessage !== undefined ? { closingMessage: dto.closingMessage } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.hashtags !== undefined ? { hashtags: dto.hashtags } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.prisma.story.delete({ where: { id } });
    return { deleted: true };
  }

  async countByUser(userId: string) {
    return this.prisma.story.count({ where: { userId } });
  }

  async ensureOwned(userId: string, id: string) {
    const story = await this.prisma.story.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return story;
  }

  async generate(userId: string, dto: GenerateStoryDto) {
    const brief = storyBriefSchema.parse({
      topic: dto.topic,
      niche: dto.niche,
      targetAudience: dto.targetAudience,
      language: dto.language ?? 'en',
      tone: dto.tone,
      desiredDurationSeconds: dto.desiredDurationSeconds,
      category: dto.category,
      additionalInstructions: dto.additionalInstructions,
    });

    const story = await this.prisma.story.create({
      data: {
        userId,
        title: brief.topic.slice(0, 120),
        content: '',
        status: StoryStatus.GENERATING,
        topic: brief.topic,
        niche: brief.niche,
        targetAudience: brief.targetAudience,
        language: brief.language,
        tone: brief.tone,
        category: brief.category,
        targetDurationSeconds: brief.desiredDurationSeconds,
      },
    });

    const { job, generation } = await this.enqueueStoryJob({
      userId,
      storyId: story.id,
      requestType: StoryGenerationType.STORY,
      jobType: 'STORY',
      brief,
      action: 'generate_story',
    });

    return { story, job, generation };
  }

  async regenerate(userId: string, storyId: string, dto: RegenerateStoryDto) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, userId } });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.status === StoryStatus.GENERATING) {
      throw new ConflictException('Story generation is already in progress');
    }

    await this.assertNoActiveJob(storyId, [
      GenerationJobType.STORY,
      GenerationJobType.SCENE_PLANNING,
    ]);

    const brief = this.buildBriefFromStory(story, dto);

    await this.prisma.story.update({
      where: { id: storyId },
      data: {
        status: StoryStatus.GENERATING,
        topic: brief.topic,
        niche: brief.niche,
        targetAudience: brief.targetAudience,
        language: brief.language,
        tone: brief.tone,
        category: brief.category,
        targetDurationSeconds: brief.desiredDurationSeconds,
      },
    });

    const { job, generation } = await this.enqueueStoryJob({
      userId,
      storyId,
      requestType: StoryGenerationType.REGENERATE,
      jobType: 'STORY',
      brief,
      action: 'regenerate_story',
    });

    return { storyId, job, generation };
  }

  async planScenes(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, userId } });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (!story.content || !story.narrationScript) {
      throw new BadRequestException('Story content must exist before planning scenes');
    }

    if (story.status === StoryStatus.GENERATING) {
      throw new ConflictException('Story generation is already in progress');
    }

    await this.assertNoActiveJob(storyId, [
      GenerationJobType.STORY,
      GenerationJobType.SCENE_PLANNING,
    ]);

    const brief = this.buildBriefFromStory(story, {});
    const generatedStory = {
      title: story.title,
      story: story.content,
      openingHook: story.openingHook ?? '',
      narrationScript: story.narrationScript ?? story.content,
      closingMessage: story.closingMessage ?? '',
      description: story.description ?? '',
      hashtags: story.hashtags,
      characters: (
        await this.prisma.characterProfile.findMany({ where: { storyId } })
      ).map((c) => ({
        name: c.name,
        appearance: c.appearance,
        clothing: c.clothing,
        ageRange: c.ageRange,
        hair: c.hair,
        distinctiveFeatures: c.distinctiveFeatures,
        consistencyNotes: c.consistencyNotes,
      })),
    };

    await this.prisma.story.update({
      where: { id: storyId },
      data: { status: StoryStatus.GENERATING },
    });

    const { job, generation } = await this.enqueueStoryJob({
      userId,
      storyId,
      requestType: StoryGenerationType.SCENES,
      jobType: 'SCENE_PLANNING',
      brief,
      action: 'plan_scenes',
      extraPayload: { generatedStory },
    });

    return { storyId, job, generation };
  }

  async attachToProject(userId: string, storyId: string, dto: AttachStoryToProjectDto) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, userId } });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (story.status !== StoryStatus.READY && story.status !== StoryStatus.DRAFT) {
      throw new BadRequestException('Only draft or ready stories can be attached to projects');
    }

    if (dto.projectId) {
      const project = await this.prisma.videoProject.findFirst({
        where: { id: dto.projectId, userId },
      });
      if (!project) {
        throw new NotFoundException('Project not found');
      }
      const updated = await this.prisma.videoProject.update({
        where: { id: project.id },
        data: {
          storyId,
          ...(story.targetDurationSeconds
            ? { duration: story.targetDurationSeconds }
            : {}),
        },
        include: { story: { select: { id: true, title: true, status: true } } },
      });
      return updated;
    }

    const title = dto.projectTitle?.trim() || `Video — ${story.title}`.slice(0, 200);
    return this.prisma.videoProject.create({
      data: {
        userId,
        storyId,
        title,
        description: story.description ?? undefined,
        duration: story.targetDurationSeconds ?? undefined,
        status: ProjectStatus.DRAFT,
      },
      include: { story: { select: { id: true, title: true, status: true } } },
    });
  }

  private buildBriefFromStory(
    story: {
      title: string;
      topic: string | null;
      niche: string | null;
      targetAudience: string | null;
      language: string;
      tone: string | null;
      category: string | null;
      targetDurationSeconds: number | null;
    },
    dto: RegenerateStoryDto,
  ): StoryBriefInput {
    return storyBriefSchema.parse({
      topic: dto.topic ?? story.topic ?? story.title,
      niche: dto.niche ?? story.niche ?? 'General',
      targetAudience: dto.targetAudience ?? story.targetAudience ?? 'General audience',
      language: dto.language ?? story.language ?? 'en',
      tone: dto.tone ?? story.tone ?? 'Inspirational',
      desiredDurationSeconds: dto.desiredDurationSeconds ?? story.targetDurationSeconds ?? 60,
      category: dto.category ?? story.category ?? 'Narrative',
      additionalInstructions: dto.additionalInstructions,
    });
  }

  private async assertNoActiveJob(storyId: string, jobTypes: GenerationJobType[]) {
    const existing = await this.prisma.generationJob.findFirst({
      where: {
        storyId,
        jobType: { in: jobTypes },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true, jobType: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        `A ${existing.jobType} job is already ${existing.status} for this story`,
      );
    }
  }

  private async enqueueStoryJob(input: {
    userId: string;
    storyId: string;
    requestType: StoryGenerationType;
    jobType: GenerationJobTypeKey;
    brief: StoryBriefInput;
    action: string;
    extraPayload?: Record<string, unknown>;
  }) {
    const queueName = JOB_TYPE_TO_QUEUE[input.jobType];
    const job = await this.prisma.generationJob.create({
      data: {
        userId: input.userId,
        storyId: input.storyId,
        jobType: input.jobType as GenerationJobType,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName,
        maxAttempts: 3,
        payload: {
          action: input.action,
          brief: input.brief,
          ...(input.extraPayload ?? {}),
        } as Prisma.InputJsonValue,
      },
    });

    const generation = await this.prisma.storyGeneration.create({
      data: {
        userId: input.userId,
        storyId: input.storyId,
        generationJobId: job.id,
        requestType: input.requestType,
        status: JobStatus.PENDING,
        promptParams: {
          action: input.action,
          brief: input.brief,
        } as Prisma.InputJsonValue,
      },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        input.jobType,
        {
          generationJobId: job.id,
          userId: input.userId,
          storyId: input.storyId,
          storyGenerationId: generation.id,
          jobType: input.jobType,
          provider: 'gemini',
          payload: {
            action: input.action,
            brief: input.brief,
            ...(input.extraPayload ?? {}),
          },
          useMockAi:
            process.env.NODE_ENV === 'test' || process.env.GEMINI_USE_MOCK === 'true',
        },
        { attempts: 3 },
      );

      const queuedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJob.id,
        },
      });

      const queuedGeneration = await this.prisma.storyGeneration.update({
        where: { id: generation.id },
        data: { status: JobStatus.QUEUED },
      });

      return {
        job: this.serializeJob(queuedJob),
        generation: this.serializeGeneration(queuedGeneration),
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
      await this.prisma.storyGeneration.update({
        where: { id: generation.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
        },
      });
      await this.prisma.story.update({
        where: { id: input.storyId },
        data: { status: StoryStatus.FAILED },
      });
      throw error;
    }
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

  private serializeGeneration(generation: {
    id: string;
    userId: string;
    storyId: string;
    generationJobId: string | null;
    requestType: StoryGenerationType;
    status: JobStatus;
    promptParams: Prisma.JsonValue;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCost: Prisma.Decimal | null;
    errorMessage: string | null;
    result: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...generation,
      estimatedCost:
        generation.estimatedCost !== null ? Number(generation.estimatedCost) : null,
    };
  }

  private serializeStoryDetail(story: {
    providerUsages: Array<{
      estimatedCost: Prisma.Decimal;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }) {
    return {
      ...story,
      providerUsages: story.providerUsages.map((usage) => ({
        ...usage,
        estimatedCost: Number(usage.estimatedCost),
      })),
    };
  }
}
