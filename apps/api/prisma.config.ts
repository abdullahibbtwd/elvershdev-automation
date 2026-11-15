import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma ORM 7 CLI config — datasource URLs live here, not in schema.prisma.
 * Runtime PrismaClient still needs a driver adapter (see prisma.service.ts).
 *
 * Avoid `env('DATABASE_URL')` here: it throws when unset, which breaks
 * `prisma generate` in CI/Docker images that don't have DB credentials.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
