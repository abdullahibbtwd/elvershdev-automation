import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUserResponse } from '../auth/auth.types';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, isActive: true },
    });
  }

  async getMe(userId: string): Promise<AuthUserResponse> {
    const user = await this.findActiveById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicUser(user);
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<AuthUserResponse> {
    const existing = await this.findActiveById(userId);
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      },
    });

    return this.toPublicUser(user);
  }

  toPublicUser(user: User): AuthUserResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
