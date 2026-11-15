import 'dotenv/config';
import { createLogger } from './lib/logger';
import { createRedisConnection } from './lib/redis';
import { createWorkers } from './processors';
import { FfmpegService } from './lib/ffmpeg';
import { disconnectPrisma } from './lib/prisma';
import { startWorkerHealthServer } from './lib/health-server';
import IORedis from 'ioredis';

const logger = createLogger('worker');
const SHUTDOWN_TIMEOUT_MS = Number.parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? '90000', 10);
const MEMORY_CHECK_MS = Number.parseInt(process.env.WORKER_MEMORY_CHECK_MS ?? '30000', 10);
const FFMPEG_KILL_CHANNEL = 'ops:ffmpeg-kill';

async function main() {
  const ffmpeg = new FfmpegService();
  const ffmpegOk = await ffmpeg.isAvailable();
  if (!ffmpegOk) {
    logger.warn('FFmpeg not found on PATH — video rendering jobs will fail until it is installed');
  } else {
    const version = await ffmpeg.getVersion();
    logger.info({ version, threads: process.env.FFMPEG_THREADS ?? '2' }, 'FFmpeg available');
  }

  const connection = createRedisConnection();
  const workers = createWorkers(connection, logger);

  // Emergency-stop FFmpeg kill signal (local children only; does not cancel remote providers)
  const killSub = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
  await killSub.subscribe(FFMPEG_KILL_CHANNEL);
  killSub.on('message', (channel, message) => {
    if (channel !== FFMPEG_KILL_CHANNEL) return;
    logger.warn({ message }, 'Emergency stop: killing local FFmpeg processes');
    FfmpegService.killAllProcesses();
  });

  const healthServer = startWorkerHealthServer(
    { startedAt: new Date(), ffmpegAvailable: ffmpegOk, workers, redis: connection },
    logger,
  );

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      logger.error(
        {
          queue: worker.name,
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          err: err.message,
        },
        'Job failed',
      );
    });
    worker.on('stalled', (jobId) => {
      logger.warn({ queue: worker.name, jobId }, 'Job stalled — BullMQ will retry');
    });
    worker.on('error', (err) => {
      logger.error({ queue: worker.name, err: err.message }, 'Worker error');
    });
  }

  const memoryLimitMb = Number.parseInt(process.env.WORKER_MEMORY_LIMIT_MB ?? '2048', 10);
  const memoryTimer = setInterval(() => {
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (rssMb >= memoryLimitMb * 0.9) {
      logger.warn({ rssMb, memoryLimitMb }, 'Worker memory pressure');
    }
  }, MEMORY_CHECK_MS);
  memoryTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown started');

    const forceTimer = setTimeout(() => {
      logger.error('Shutdown timeout exceeded — killing FFmpeg and exiting');
      FfmpegService.killAllProcesses();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      healthServer.close();
      // Stop accepting new jobs; wait for in-flight with BullMQ close
      await Promise.all(workers.map((worker) => worker.close()));
      FfmpegService.killAllProcesses();
      await killSub.quit().catch(() => undefined);
      await connection.quit();
      await disconnectPrisma();
      clearTimeout(forceTimer);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown error');
      FfmpegService.killAllProcesses();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
  });

  logger.info(
    {
      queues: workers.map((w) => w.name),
      concurrency: {
        default: process.env.WORKER_CONCURRENCY ?? '2',
        render: process.env.VIDEO_RENDER_MAX_CONCURRENCY ?? '1',
        image: process.env.IMAGE_GENERATION_MAX_CONCURRENCY ?? process.env.WORKER_CONCURRENCY ?? '2',
        publish: process.env.PUBLISHING_MAX_CONCURRENCY ?? process.env.WORKER_CONCURRENCY ?? '2',
        kling: process.env.KLING_MAX_CONCURRENCY ?? process.env.WORKER_CONCURRENCY ?? '2',
        tts: process.env.GEMINI_TTS_MAX_CONCURRENCY ?? process.env.WORKER_CONCURRENCY ?? '2',
      },
    },
    'Worker started and listening for jobs',
  );
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Worker failed to start');
  process.exit(1);
});
