import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GenerationJobType,
  JobStatus,
  Prisma,
  ProjectStatus,
} from '@prisma/client';
import type { GenerationJobTypeKey, QueueName } from '@ai-video/shared';
import { JOB_TYPE_TO_QUEUE } from '@ai-video/shared';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly projectsService: ProjectsService,
  ) {}

  private async assertEmergencyStopClear() {
    const row = await this.prisma.setting.findUnique({
      where: { key: 'system:automation:emergencyStop' },
    });
    const active =
      !!row &&
      typeof row.value === 'object' &&
      row.value !== null &&
      (row.value as { active?: boolean }).active === true;
    if (active) {
      throw new ServiceUnavailableException(
        'Global emergency stop is active — new generation jobs are blocked',
      );
    }
  }

  async create(userId: string, dto: CreateJobDto) {
    await this.assertEmergencyStopClear();
    if (dto.videoProjectId) {
      await this.projectsService.ensureOwned(userId, dto.videoProjectId);
    }

    const jobType = dto.jobType as GenerationJobTypeKey;
    const queueName = JOB_TYPE_TO_QUEUE[jobType];

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        videoProjectId: dto.videoProjectId,
        storyId: dto.storyId,
        jobType: dto.jobType,
        status: JobStatus.PENDING,
        provider: dto.provider,
        estimatedCost: dto.estimatedCost,
        payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
        queueName,
        maxAttempts: 3,
      },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        jobType,
        {
          generationJobId: job.id,
          userId,
          videoProjectId: dto.videoProjectId,
          storyId: dto.storyId,
          jobType,
          provider: dto.provider,
          payload: {
            ...(dto.payload ?? {}),
            ...(dto.simulateFailure ? { simulateFailure: true } : {}),
          },
          simulateFailure: dto.simulateFailure === true,
        },
        {
          attempts: dto.simulateFailure ? 1 : 3,
        },
      );

      const queued = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJob.id,
        },
      });

      if (dto.videoProjectId) {
        await this.prisma.videoProject.updateMany({
          where: { id: dto.videoProjectId, userId },
          data: { status: ProjectStatus.PROCESSING },
        });
      }

      return this.serialize(queued);
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

  async list(userId: string, query: ListJobsDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.GenerationJobWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.jobType ? { jobType: query.jobType } : {}),
      ...(query.videoProjectId ? { videoProjectId: query.videoProjectId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.generationJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.generationJob.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(userId: string, id: string) {
    const job = await this.prisma.generationJob.findFirst({ where: { id, userId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return this.serialize(job);
  }

  async cancel(userId: string, id: string) {
    const job = await this.prisma.generationJob.findFirst({ where: { id, userId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== JobStatus.PENDING && job.status !== JobStatus.QUEUED) {
      throw new BadRequestException('Only pending or queued jobs can be cancelled');
    }

    if (job.queueName && job.queueJobId) {
      await this.queueService.removeJob(job.queueName as QueueName, job.queueJobId);
    }

    const updated = await this.prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.CANCELLED,
        completedAt: new Date(),
        errorMessage: 'Cancelled by user',
      },
    });

    return this.serialize(updated);
  }

  async retry(userId: string, id: string) {
    const job = await this.prisma.generationJob.findFirst({ where: { id, userId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    if (job.status !== JobStatus.FAILED && job.status !== JobStatus.CANCELLED) {
      throw new BadRequestException('Only failed or cancelled jobs can be retried');
    }

    const jobType = job.jobType as GenerationJobTypeKey;
    const queueName = JOB_TYPE_TO_QUEUE[jobType];
    const payload =
      job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : {};

    // Remove previous failed/completed BullMQ job with the same deterministic jobId
    // so BullMQ accepts a fresh enqueue for this generationJobId.
    if (job.queueJobId) {
      await this.queueService.removeJob(queueName, job.queueJobId);
    }
    await this.queueService.removeJob(queueName, job.id);

    const reset = await this.prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.PENDING,
        progress: 0,
        errorMessage: null,
        result: Prisma.JsonNull,
        completedAt: null,
        startedAt: null,
        queueJobId: null,
        attempts: 0,
      },
    });

    const { job: bullJob } = await this.queueService.enqueueGenerationJob(jobType, {
      generationJobId: reset.id,
      userId,
      videoProjectId: reset.videoProjectId,
      storyId: reset.storyId,
      jobType,
      provider: reset.provider,
      payload,
      simulateFailure: Boolean(payload.simulateFailure),
      useMockAi:
        process.env.NODE_ENV === 'test' ||
        process.env.GEMINI_USE_MOCK === 'true' ||
        process.env.FAL_USE_MOCK === 'true' ||
        process.env.KLING_USE_MOCK === 'true',
    });

    const queued = await this.prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.QUEUED,
        queueJobId: bullJob.id,
        queueName,
      },
    });

    return this.serialize(queued);
  }

  async countByUser(userId: string, status?: JobStatus) {
    return this.prisma.generationJob.count({
      where: { userId, ...(status ? { status } : {}) },
    });
  }

  private serialize(job: {
    id: string;
    userId: string;
    videoProjectId: string | null;
    storyId?: string | null;
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
