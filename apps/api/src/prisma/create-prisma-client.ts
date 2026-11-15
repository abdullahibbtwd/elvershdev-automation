import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** Prisma 7 requires a driver adapter for database connections. */
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
