import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BUILTIN_VISUAL_STYLES,
  visualStyleConfigurationSchema,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisualStyleDto } from './dto/create-visual-style.dto';
import { UpdateVisualStyleDto } from './dto/update-visual-style.dto';

@Injectable()
export class VisualStylesService implements OnModuleInit {
  private readonly logger = new Logger(VisualStylesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.seedBuiltinStyles();
    } catch (error) {
      this.logger.warn(
        `Failed to seed built-in visual styles: ${(error as Error).message}`,
      );
    }
  }

  async seedBuiltinStyles() {
    for (const style of BUILTIN_VISUAL_STYLES) {
      const existing = await this.prisma.visualStyle.findFirst({
        where: { name: style.name, isSystem: true },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.visualStyle.create({
          data: {
            userId: null,
            name: style.name,
            description: style.description,
            configuration: style.configuration as unknown as Prisma.InputJsonValue,
            isDefault: Boolean(style.isDefault),
            isSystem: true,
          },
        });
      }
    }
  }

  async list(userId: string) {
    const systemCount = await this.prisma.visualStyle.count({
      where: { isSystem: true },
    });
    if (systemCount === 0) {
      await this.seedBuiltinStyles();
    }

    return this.prisma.visualStyle.findMany({
      where: {
        OR: [{ isSystem: true }, { userId }],
      },
      orderBy: [{ isSystem: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateVisualStyleDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.visualStyle.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Visual style "${name}" already exists`);
    }

    const configuration = visualStyleConfigurationSchema.parse(dto.configuration);

    if (dto.isDefault) {
      await this.prisma.visualStyle.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.visualStyle.create({
      data: {
        userId,
        name,
        description: dto.description.trim(),
        configuration: configuration as unknown as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
        isSystem: false,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateVisualStyleDto) {
    const style = await this.prisma.visualStyle.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException('Visual style not found');
    }
    if (style.isSystem) {
      throw new ForbiddenException('System visual styles cannot be modified');
    }
    if (style.userId !== userId) {
      throw new NotFoundException('Visual style not found');
    }

    const nextName = dto.name !== undefined ? dto.name.trim() : undefined;
    if (nextName && nextName !== style.name) {
      const duplicate = await this.prisma.visualStyle.findFirst({
        where: { userId, name: nextName, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(`Visual style "${nextName}" already exists`);
      }
    }

    let nextConfiguration: Prisma.InputJsonValue | undefined;
    if (dto.configuration !== undefined) {
      const currentConfig =
        style.configuration &&
        typeof style.configuration === 'object' &&
        !Array.isArray(style.configuration)
          ? (style.configuration as Record<string, unknown>)
          : {};
      const parsed = visualStyleConfigurationSchema.parse({
        ...currentConfig,
        ...dto.configuration,
      });
      nextConfiguration = parsed as unknown as Prisma.InputJsonValue;
    }

    if (dto.isDefault === true) {
      await this.prisma.visualStyle.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return this.prisma.visualStyle.update({
      where: { id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(nextConfiguration !== undefined ? { configuration: nextConfiguration } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    const style = await this.prisma.visualStyle.findUnique({ where: { id } });
    if (!style) {
      throw new NotFoundException('Visual style not found');
    }
    if (style.isSystem) {
      throw new ForbiddenException('System visual styles cannot be deleted');
    }
    if (style.userId !== userId) {
      throw new NotFoundException('Visual style not found');
    }

    await this.prisma.visualStyle.delete({ where: { id } });
    return { deleted: true };
  }

  async getDefault() {
    let style = await this.prisma.visualStyle.findFirst({
      where: { isSystem: true, isDefault: true },
    });
    if (!style) {
      await this.seedBuiltinStyles();
      style =
        (await this.prisma.visualStyle.findFirst({
          where: { isSystem: true, isDefault: true },
        })) ??
        (await this.prisma.visualStyle.findFirst({
          where: { isSystem: true },
        }));
    }
    if (!style) {
      throw new NotFoundException('Default visual style not found');
    }
    return style;
  }

  async ensureAccessible(userId: string, styleId: string) {
    const style = await this.prisma.visualStyle.findFirst({
      where: {
        id: styleId,
        OR: [{ isSystem: true }, { userId }],
      },
    });
    if (!style) {
      throw new NotFoundException('Visual style not found');
    }
    return style;
  }
}
