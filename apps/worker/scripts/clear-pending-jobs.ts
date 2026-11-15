import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from 'dotenv';
import path from 'node:path';
import { ALL_QUEUE_NAMES } from '@ai-video/shared';
import { PrismaClient, JobStatus, ContentScheduleStatus, StoryStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

config({ path: path.resolve(__dirname, '../../../.env') });

async function clearQueues() {
  const connection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  const results: Array<{
    name: string;
    before?: Record<string, number>;
    cleared: boolean;
    error?: string;
  }> = [];

  for (const name of [...new Set(ALL_QUEUE_NAMES)]) {
    const queue = new Queue(name, { connection });
    try {
      const before = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'paused',
        'failed',
        'completed',
      );
      await queue.obliterate({ force: true });
      results.push({ name, before, cleared: true });
    } catch (error) {
      results.push({
        name,
        cleared: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await queue.close();
    }
  }

  await connection.quit();
  return results;
}

async function clearDb() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const jobs = await prisma.generationJob.updateMany({
      where: {
        status: { in: [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING] },
      },
      data: {
        status: JobStatus.CANCELLED,
        errorMessage: 'Cleared pending jobs by operator',
        completedAt: new Date(),
      },
    });

    const schedules = await prisma.contentSchedule.updateMany({
      where: {
        status: {
          in: [
            ContentScheduleStatus.PLANNED,
            ContentScheduleStatus.QUEUED,
            ContentScheduleStatus.GENERATING,
            ContentScheduleStatus.RENDERING,
            ContentScheduleStatus.SCHEDULING_PUBLISH,
            ContentScheduleStatus.PUBLISHING,
          ],
        },
      },
      data: {
        status: ContentScheduleStatus.CANCELLED,
        cancelledAt: new Date(),
        lastError: 'Cleared pending jobs by operator',
      },
    });

    const stories = await prisma.story.updateMany({
      where: { status: StoryStatus.GENERATING },
      data: { status: StoryStatus.FAILED },
    });

    return {
      generationJobsCancelled: jobs.count,
      schedulesCancelled: schedules.count,
      storiesMarkedFailed: stories.count,
    };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function main() {
  const queues = await clearQueues();
  const db = await clearDb();
  console.log(
    JSON.stringify(
      {
        queuesCleared: queues.filter((q) => q.cleared).length,
        queuesTotal: queues.length,
        queues,
        db,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
