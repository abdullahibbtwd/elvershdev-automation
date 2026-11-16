import type { INestApplication } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Seed a user directly (public registration is disabled). */
export async function seedUser(
  prisma: PrismaService,
  input: { name: string; email: string; password: string; role?: UserRole },
) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase().trim(),
      passwordHash: await bcrypt.hash(input.password, 4),
      ...(input.role ? { role: input.role } : {}),
    },
  });
}

/** Login and return the full supertest response (includes accessToken + refresh cookie). */
export async function loginUser(
  app: INestApplication<App>,
  email: string,
  password: string,
) {
  return request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
}

/** Seed then login — drop-in for former POST /auth/register in e2e tests. */
export async function seedAndLogin(
  app: INestApplication<App>,
  prisma: PrismaService,
  input: { name: string; email: string; password: string; role?: UserRole },
) {
  await seedUser(prisma, input);
  return loginUser(app, input.email, input.password);
}
