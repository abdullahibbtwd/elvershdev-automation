import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  SystemAlertSeverity,
  SystemAlertStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmtpService } from './smtp.service';

export type AlertType =
  | 'api_down'
  | 'worker_down'
  | 'database_failure'
  | 'redis_failure'
  | 'minio_failure'
  | 'disk_usage'
  | 'memory_pressure'
  | 'queue_failures'
  | 'queue_backlog'
  | 'stalled_jobs'
  | 'publish_failures'
  | 'oauth_expired'
  | 'backup_failed'
  | 'budget_limit'
  | 'provider_spend'
  | 'provider_failure';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly smtp: SmtpService,
    private readonly notifications: NotificationsService,
  ) {}

  async fire(input: {
    type: AlertType;
    dedupeKey: string;
    title: string;
    body: string;
    severity?: SystemAlertSeverity;
    metadata?: Record<string, unknown>;
    notifyUserId?: string;
  }) {
    if (this.config.get<string>('alerts.enabled', 'true') === 'false') {
      return null;
    }

    const cooldownMinutes = this.config.get<number>('alerts.cooldownMinutes', 30);
    const now = new Date();
    const severity = input.severity ?? SystemAlertSeverity.WARNING;

    const existing = await this.prisma.systemAlert.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });

    if (
      existing &&
      existing.status === SystemAlertStatus.OPEN &&
      existing.cooldownUntil &&
      existing.cooldownUntil > now
    ) {
      return existing;
    }

    const cooldownUntil = new Date(now.getTime() + cooldownMinutes * 60_000);
    let alert;
    if (existing) {
      alert = await this.prisma.systemAlert.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          body: input.body,
          severity,
          status: SystemAlertStatus.OPEN,
          occurrenceCount: { increment: 1 },
          lastFiredAt: now,
          cooldownUntil,
          resolvedAt: null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } else {
      alert = await this.prisma.systemAlert.create({
        data: {
          dedupeKey: input.dedupeKey,
          type: input.type,
          title: input.title,
          body: input.body,
          severity,
          cooldownUntil,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    const adminEmail = this.config.get<string>('alerts.adminEmail');
    if (adminEmail && this.smtp.isConfigured()) {
      const sent = await this.smtp.sendMail({
        to: adminEmail,
        subject: `[${severity}] ${input.title}`,
        text: `${input.body}\n\nType: ${input.type}\nDedupe: ${input.dedupeKey}`,
      });
      if (sent) {
        await this.prisma.systemAlert.update({
          where: { id: alert.id },
          data: { emailSentAt: new Date() },
        });
      }
    }

    if (input.notifyUserId) {
      await this.notifications.notify({
        userId: input.notifyUserId,
        type: `system_alert:${input.type}`,
        title: input.title,
        body: input.body,
        dedupeKey: `alert:${input.dedupeKey}`,
        metadata: input.metadata,
      });
    }

    this.logger.warn({ type: input.type, dedupeKey: input.dedupeKey }, input.title);
    return alert;
  }

  async resolve(dedupeKey: string, recoveryMessage?: string) {
    const existing = await this.prisma.systemAlert.findUnique({ where: { dedupeKey } });
    if (!existing || existing.status === SystemAlertStatus.RESOLVED) {
      return existing;
    }
    const alert = await this.prisma.systemAlert.update({
      where: { id: existing.id },
      data: {
        status: SystemAlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    const adminEmail = this.config.get<string>('alerts.adminEmail');
    if (adminEmail && this.smtp.isConfigured() && recoveryMessage) {
      await this.smtp.sendMail({
        to: adminEmail,
        subject: `[RECOVERED] ${existing.title}`,
        text: recoveryMessage,
      });
    }
    return alert;
  }

  list(query: { status?: SystemAlertStatus; limit?: number }) {
    return this.prisma.systemAlert.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { lastFiredAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
  }
}
