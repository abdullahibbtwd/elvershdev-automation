import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentScheduleStatus, Prisma } from '@prisma/client';
import {
  addMinutes,
  formatDateInTimeZone,
  getZonedParts,
  zonedDateTimeToUtc,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationConfigService } from './automation-config.service';
import { AutomationOrchestratorService } from './automation-orchestrator.service';
import { CalendarQueryDto, RescheduleCalendarDto } from './dto/list-automation.dto';

@Injectable()
export class AutomationCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AutomationConfigService,
    private readonly orchestrator: AutomationOrchestratorService,
  ) {}

  async getCalendar(userId: string, query: CalendarQueryDto) {
    const config = await this.configService.getOrCreate(userId);
    const view = query.view ?? 'week';
    const anchor = query.date?.slice(0, 10) ?? formatDateInTimeZone(new Date(), config.timezone);
    const { from, to } = this.rangeForView(anchor, view, config.timezone);

    const plans = await this.prisma.contentPlan.findMany({
      where: {
        userId,
        plannedDate: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      include: {
        schedule: {
          include: {
            scheduledPublications: {
              orderBy: { scheduledAt: 'asc' },
            },
          },
        },
      },
      orderBy: [{ plannedDate: 'asc' }, { slotIndex: 'asc' }],
    });

    const days: Record<string, unknown[]> = {};
    for (const plan of plans) {
      const key = formatDateInTimeZone(
        new Date(`${plan.plannedDate.toISOString().slice(0, 10)}T12:00:00.000Z`),
        'UTC',
      );
      const dateKey = plan.plannedDate.toISOString().slice(0, 10);
      if (!days[dateKey]) days[dateKey] = [];
      days[dateKey].push(this.serializeSlot(plan));
      void key;
    }

    return {
      view,
      timezone: config.timezone,
      anchor,
      from,
      to,
      days,
      items: plans.map((plan) => this.serializeSlot(plan)),
    };
  }

  async reschedule(userId: string, scheduleId: string, dto: RescheduleCalendarDto) {
    const schedule = await this.prisma.contentSchedule.findFirst({
      where: { id: scheduleId, userId },
      include: { scheduledPublications: true },
    });
    if (!schedule) throw new NotFoundException('Calendar schedule not found');

    const scheduledGenerationAt = new Date(dto.scheduledGenerationAt);
    const scheduledPublishAt = dto.scheduledPublishAt
      ? new Date(dto.scheduledPublishAt)
      : addMinutes(scheduledGenerationAt, 60);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.contentSchedule.update({
        where: { id: scheduleId },
        data: {
          scheduledGenerationAt,
          scheduledPublishAt,
          ...(schedule.status === ContentScheduleStatus.PAUSED
            ? { status: ContentScheduleStatus.PLANNED, pausedAt: null }
            : {}),
        },
        include: { contentPlan: true, scheduledPublications: true },
      });

      for (const pub of schedule.scheduledPublications) {
        if (pub.status === 'SCHEDULED' || pub.status === 'PENDING') {
          await tx.scheduledPublication.update({
            where: { id: pub.id },
            data: { scheduledAt: scheduledPublishAt },
          });
        }
      }
      return next;
    });

    return updated;
  }

  async cancel(userId: string, scheduleId: string) {
    return this.orchestrator.cancelSchedule(userId, scheduleId);
  }

  private serializeSlot(
    plan: Prisma.ContentPlanGetPayload<{
      include: {
        schedule: { include: { scheduledPublications: true } };
      };
    }>,
  ) {
    const schedule = plan.schedule;
    return {
      id: schedule?.id ?? plan.id,
      planId: plan.id,
      plannedDate: plan.plannedDate,
      slotIndex: plan.slotIndex,
      ideaTitle: plan.ideaTitle,
      ideaSummary: plan.ideaSummary,
      category: plan.category,
      theme: plan.theme,
      planStatus: plan.status,
      scheduleStatus: schedule?.status ?? null,
      generationStatus: schedule?.currentStage ?? null,
      renderingStatus:
        schedule?.currentStage === 'RENDER' || schedule?.videoRenderId
          ? schedule?.status
          : null,
      publishingStatus: this.summarizePublishing(schedule?.scheduledPublications ?? []),
      scheduledGenerationAt: schedule?.scheduledGenerationAt ?? null,
      scheduledPublishAt: schedule?.scheduledPublishAt ?? null,
      storyId: schedule?.storyId ?? plan.storyId,
      videoRenderId: schedule?.videoRenderId ?? null,
      lastError: schedule?.lastError ?? plan.lastError,
      publications: (schedule?.scheduledPublications ?? []).map((pub) => ({
        id: pub.id,
        platform: pub.platform,
        status: pub.status,
        scheduledAt: pub.scheduledAt,
        publishedAt: pub.publishedAt,
        lastError: pub.lastError,
      })),
      actions: {
        canReschedule: !!schedule && !['COMPLETED', 'CANCELLED'].includes(schedule.status),
        canCancel: !!schedule && !['COMPLETED', 'CANCELLED'].includes(schedule.status),
        canTrigger: !!schedule && !['COMPLETED', 'CANCELLED'].includes(schedule.status),
        canPause: !!schedule && !['COMPLETED', 'CANCELLED', 'PAUSED'].includes(schedule.status),
      },
    };
  }

  private summarizePublishing(
    pubs: Array<{ platform: string; status: string }>,
  ): Record<string, string> {
    const summary: Record<string, string> = {};
    for (const pub of pubs) {
      summary[pub.platform] = pub.status;
    }
    return summary;
  }

  private rangeForView(anchor: string, view: 'day' | 'week' | 'month', timeZone: string) {
    const anchorUtc = zonedDateTimeToUtc(anchor, '12:00', timeZone);
    const parts = getZonedParts(anchorUtc, timeZone);

    if (view === 'day') {
      return { from: anchor, to: anchor };
    }

    if (view === 'week') {
      const weekday = parts.weekday;
      const start = addMinutes(anchorUtc, -weekday * 24 * 60);
      const end = addMinutes(start, 6 * 24 * 60);
      return {
        from: formatDateInTimeZone(start, timeZone),
        to: formatDateInTimeZone(end, timeZone),
      };
    }

    const monthStart = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
    const nextMonth =
      parts.month === 12
        ? `${parts.year + 1}-01-01`
        : `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-01`;
    const monthEndUtc = addMinutes(zonedDateTimeToUtc(nextMonth, '00:00', timeZone), -1);
    return {
      from: monthStart,
      to: formatDateInTimeZone(monthEndUtc, timeZone),
    };
  }
}
