import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    dedupeKey?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: {
          userId_dedupeKey: {
            userId: input.userId,
            dedupeKey: input.dedupeKey,
          },
        },
      });
      if (existing) {
        return existing;
      }
    }

    try {
      return await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          dedupeKey: input.dedupeKey ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.dedupeKey
      ) {
        return this.prisma.notification.findUniqueOrThrow({
          where: {
            userId_dedupeKey: {
              userId: input.userId,
              dedupeKey: input.dedupeKey,
            },
          },
        });
      }
      throw error;
    }
  }

  async list(
    userId: string,
    query: { page?: number; limit?: number; unreadOnly?: boolean },
  ) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items,
      meta: { ...paginationMeta(page, limit, total), unreadCount },
    };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.readAt) {
      return notification;
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
