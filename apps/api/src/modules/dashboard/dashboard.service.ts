import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string) {
    const [
      projects,
      stories,
      media,
      jobs,
      channels,
      publishing,
      recentProjects,
      recentJobs,
      failedJobs,
      processingJobs,
    ] = await this.prisma.$transaction([
      this.prisma.videoProject.count({ where: { userId } }),
      this.prisma.story.count({ where: { userId } }),
      this.prisma.mediaAsset.count({ where: { userId } }),
      this.prisma.generationJob.count({ where: { userId } }),
      this.prisma.socialChannel.count({ where: { userId } }),
      this.prisma.publishRecord.count({ where: { userId } }),
      this.prisma.videoProject.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          aspectRatio: true,
        },
      }),
      this.prisma.generationJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          jobType: true,
          status: true,
          progress: true,
          createdAt: true,
        },
      }),
      this.prisma.generationJob.count({
        where: { userId, status: JobStatus.FAILED },
      }),
      this.prisma.generationJob.count({
        where: {
          userId,
          status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] },
        },
      }),
    ]);

    return {
      counts: {
        projects,
        stories,
        media,
        jobs,
        channels,
        publishing,
        failedJobs,
        processingJobs,
      },
      recentProjects,
      recentJobs,
    };
  }
}
