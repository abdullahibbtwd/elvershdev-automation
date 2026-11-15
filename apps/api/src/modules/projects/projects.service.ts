import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    if (dto.storyId) {
      await this.assertStoryOwnership(userId, dto.storyId);
    }

    return this.prisma.videoProject.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        storyId: dto.storyId,
        duration: dto.duration,
        aspectRatio: dto.aspectRatio,
        status: dto.status ?? ProjectStatus.DRAFT,
        targetPlatforms: dto.targetPlatforms ?? [],
      },
      include: { story: true },
    });
  }

  async list(userId: string, query: ListProjectsDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.VideoProjectWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.platform ? { targetPlatforms: { has: query.platform } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.videoProject.findMany({
        where,
        include: { story: { select: { id: true, title: true, status: true } } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.videoProject.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async getById(userId: string, id: string) {
    const project = await this.prisma.videoProject.findFirst({
      where: { id, userId },
      include: {
        story: true,
        mediaAssets: { orderBy: { createdAt: 'desc' }, take: 20 },
        generationJobs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return this.serializeProject(project);
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.ensureOwned(userId, id);
    if (dto.storyId) {
      await this.assertStoryOwnership(userId, dto.storyId);
    }

    const project = await this.prisma.videoProject.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
        ...(dto.storyId !== undefined ? { storyId: dto.storyId } : {}),
        ...(dto.duration !== undefined ? { duration: dto.duration } : {}),
        ...(dto.aspectRatio !== undefined ? { aspectRatio: dto.aspectRatio } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.targetPlatforms !== undefined ? { targetPlatforms: dto.targetPlatforms } : {}),
      },
      include: { story: true },
    });

    return project;
  }

  async remove(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.prisma.videoProject.delete({ where: { id } });
    return { deleted: true };
  }

  async countByUser(userId: string) {
    return this.prisma.videoProject.count({ where: { userId } });
  }

  async ensureOwned(userId: string, id: string) {
    const project = await this.prisma.videoProject.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  private async assertStoryOwnership(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      select: { id: true },
    });
    if (!story) {
      throw new BadRequestException('Story not found for current user');
    }
  }

  private serializeProject<T extends { mediaAssets?: Array<{ fileSize: bigint | null }> }>(
    project: T,
  ) {
    return {
      ...project,
      mediaAssets: project.mediaAssets?.map((asset) => ({
        ...asset,
        fileSize: asset.fileSize !== null && asset.fileSize !== undefined
          ? Number(asset.fileSize)
          : null,
      })),
    };
  }
}
