import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BUILTIN_VISUAL_STYLES } from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualStylesService } from './visual-styles.service';

describe('VisualStylesService', () => {
  const validConfig = {
    lighting: 'Warm golden hour light',
    colorTreatment: 'Rich natural contrast',
    camera: '35mm prime',
    composition: 'Rule of thirds',
    imageGenerationInstructions: 'Photorealistic still.',
    avoid: ['cartoon', 'anime'],
  };

  function createService() {
    const prisma = {
      visualStyle: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    const service = new VisualStylesService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  it('seeds built-in visual styles on module init when missing', async () => {
    const { service, prisma } = createService();
    prisma.visualStyle.findFirst.mockResolvedValue(null);
    prisma.visualStyle.create.mockResolvedValue({ id: 'style-1' });

    await service.onModuleInit();

    expect(prisma.visualStyle.findFirst).toHaveBeenCalledTimes(
      BUILTIN_VISUAL_STYLES.length,
    );
    expect(prisma.visualStyle.create).toHaveBeenCalledTimes(
      BUILTIN_VISUAL_STYLES.length,
    );
  });

  it('forbids updating or deleting system styles', async () => {
    const { service, prisma } = createService();
    prisma.visualStyle.findUnique.mockResolvedValue({
      id: 'sys-1',
      userId: null,
      isSystem: true,
    });

    await expect(
      service.update('user-1', 'sys-1', { name: 'Hacked' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove('user-1', 'sys-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns 404 when updating another user style', async () => {
    const { service, prisma } = createService();
    prisma.visualStyle.findUnique.mockResolvedValue({
      id: 'style-2',
      userId: 'user-2',
      isSystem: false,
    });

    await expect(
      service.update('user-1', 'style-2', { name: 'Mine' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('prevents duplicate user style names', async () => {
    const { service, prisma } = createService();
    prisma.visualStyle.findFirst.mockResolvedValue({ id: 'existing-1' });

    await expect(
      service.create('user-1', {
        name: 'Custom Look',
        description: 'Desc',
        configuration: validConfig,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows system styles for any user in ensureAccessible', async () => {
    const { service, prisma } = createService();
    const systemStyle = { id: 'sys-1', isSystem: true, userId: null };
    prisma.visualStyle.findFirst.mockResolvedValue(systemStyle);

    await expect(service.ensureAccessible('user-1', 'sys-1')).resolves.toEqual(
      systemStyle,
    );
  });
});
