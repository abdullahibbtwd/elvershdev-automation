import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const DEFAULTS = {
  defaultAspectRatio: '9:16',
  emailNotifications: true,
  preferredLanguage: 'en',
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private keyForUser(userId: string) {
    return `user:${userId}:preferences`;
  }

  async getForUser(userId: string) {
    const setting = await this.prisma.setting.findUnique({
      where: { key: this.keyForUser(userId) },
    });
    const value =
      setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
        ? (setting.value as Record<string, unknown>)
        : {};
    return { ...DEFAULTS, ...value };
  }

  async updateForUser(userId: string, dto: UpdateSettingsDto) {
    const current = await this.getForUser(userId);
    const next = {
      ...current,
      ...dto,
    };

    await this.prisma.setting.upsert({
      where: { key: this.keyForUser(userId) },
      create: {
        key: this.keyForUser(userId),
        value: next as Prisma.InputJsonValue,
      },
      update: {
        value: next as Prisma.InputJsonValue,
      },
    });

    return next;
  }
}
