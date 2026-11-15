import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type {
  AccessTokenPayload,
  AuthResult,
  AuthUserResponse,
  RefreshTokenPayload,
} from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ result: AuthResult; refreshToken: string }> {
    const registrationEnabled = this.config.get<boolean>('ops.registrationEnabled', true);
    if (!registrationEnabled) {
      throw new ConflictException('Registration is disabled');
    }

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash,
      },
    });

    return this.issueAuthBundle(user);
  }

  async login(dto: LoginDto): Promise<{ result: AuthResult; refreshToken: string }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueAuthBundle(user);
  }

  async refresh(rawRefreshToken?: string): Promise<{ result: AuthResult; refreshToken: string }> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh session not found');
    }

    if (session.revokedAt) {
      // Possible token reuse — revoke all sessions for this user
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    if (tokenHash !== session.tokenHash) {
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token mismatch');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    // Rotate: revoke current session and issue a new one
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueAuthBundle(session.user);
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
        ignoreExpiration: true,
      });
      if (payload.sid) {
        await this.prisma.refreshSession.updateMany({
          where: { id: payload.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Idempotent logout
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUserResponse> {
    const user = await this.usersService.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return this.toAuthUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new ConflictException('New password must be different from the current password');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueAuthBundle(user: {
    id: string;
    email: string;
    name: string;
    role: AuthUserResponse['role'];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<{ result: AuthResult; refreshToken: string }> {
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn', '15m');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn', '7d');

    const refreshExpiresAt = new Date(Date.now() + this.parseDurationToMs(refreshExpiresIn));

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    // Create session row first so we can embed sid in JWT; token hash updated after signing
    const session = await this.prisma.refreshSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenHash: 'pending',
        expiresAt: refreshExpiresAt,
      },
    });

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sid: session.id,
      type: 'refresh',
    };

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: refreshExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { tokenHash: this.hashToken(refreshToken) },
    });

    return {
      refreshToken,
      result: {
        user: this.toAuthUser(user),
        accessToken,
        expiresIn: Math.floor(this.parseDurationToMs(accessExpiresIn) / 1000),
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuthUser(user: {
    id: string;
    email: string;
    name: string;
    role: AuthUserResponse['role'];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): AuthUserResponse {
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

  private parseDurationToMs(value: string): number {
    const match = /^(\d+)([smhd])$/i.exec(value.trim());
    if (!match) {
      return 15 * 60 * 1000;
    }
    const amount = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return amount * (multipliers[unit] ?? 60_000);
  }
}
