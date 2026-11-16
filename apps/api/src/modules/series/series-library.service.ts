import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SeriesApprovalStatus, StorySeriesStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SeriesLifecycleHandoffService } from './series-lifecycle-handoff.service';

@Injectable()
export class SeriesLibraryService {
  private readonly logger = new Logger(SeriesLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handoff: SeriesLifecycleHandoffService,
  ) {}

  async list(
    userId: string,
    options?: { laneId?: string; status?: StorySeriesStatus; take?: number; skip?: number },
  ) {
    const take = Math.min(options?.take ?? 50, 100);
    const skip = options?.skip ?? 0;
    const where: Prisma.StorySeriesWhereInput = {
      userId,
      ...(options?.laneId ? { laneId: options.laneId } : {}),
      ...(options?.status ? { status: options.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.storySeries.findMany({
        where,
        include: {
          lane: { select: { id: true, laneType: true } },
          _count: { select: { episodes: true, characters: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.storySeries.count({ where }),
    ]);

    return {
      items,
      total,
      take,
      skip,
    };
  }

  async getBible(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { id: true, title: true },
    });
    if (!series) throw new NotFoundException('Series not found');

    const bible = await this.prisma.seriesBible.findUnique({ where: { seriesId } });
    if (!bible) throw new NotFoundException('Series bible not found');
    return { series, bible };
  }

  async approveSeries(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      include: { bible: true },
    });
    if (!series) throw new NotFoundException('Series not found');
    if (!series.bible?.ending?.trim()) {
      throw new BadRequestException('Cannot approve a series without a complete bible ending');
    }

    const updated = await this.prisma.storySeries.update({
      where: { id: seriesId },
      data: {
        approvalStatus: SeriesApprovalStatus.APPROVED,
        approvedAt: new Date(),
        status:
          series.status === StorySeriesStatus.REPLACEMENT_CANDIDATE
            ? StorySeriesStatus.REPLACEMENT_CANDIDATE
            : series.status === StorySeriesStatus.FAILED
              ? StorySeriesStatus.READY
              : series.status === StorySeriesStatus.DRAFT ||
                  series.status === StorySeriesStatus.PLANNING
                ? StorySeriesStatus.READY
                : series.status,
      },
    });

    await this.prisma.seriesBible.update({
      where: { seriesId },
      data: { approvedAt: new Date() },
    });

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.approve',
        entityType: 'StorySeries',
        entityId: seriesId,
        after: { approvalStatus: updated.approvalStatus, status: updated.status },
      },
    });

    try {
      await this.handoff.afterMovieApproved(userId, seriesId);
    } catch (error) {
      this.logger.warn(
        `Post-movie-approval handoff failed series=${seriesId}: ${(error as Error).message}`,
      );
    }

    return updated;
  }

  async rejectSeries(userId: string, seriesId: string, reason?: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
    });
    if (!series) throw new NotFoundException('Series not found');

    const updated = await this.prisma.storySeries.update({
      where: { id: seriesId },
      data: {
        approvalStatus: SeriesApprovalStatus.REJECTED,
        metadata: {
          ...(typeof series.metadata === 'object' && series.metadata
            ? (series.metadata as object)
            : {}),
          rejectionReason: reason ?? 'Rejected by user',
        },
      },
    });

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.reject',
        entityType: 'StorySeries',
        entityId: seriesId,
        after: { reason: reason ?? null },
      },
    });

    return updated;
  }
}
