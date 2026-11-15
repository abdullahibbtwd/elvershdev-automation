import http from 'node:http';
import type { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { Logger } from './logger';
import { getPrisma } from './prisma';
import { getMinioBucket, getMinioEndpoint } from './storage';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

export interface WorkerHealthState {
  startedAt: Date;
  ffmpegAvailable: boolean;
  workers: Worker[];
  redis?: IORedis;
}

export function startWorkerHealthServer(
  state: WorkerHealthState,
  logger: Logger,
): http.Server {
  const port = Number.parseInt(process.env.WORKER_HEALTH_PORT ?? '3101', 10);

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url === '/health/live') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
        return;
      }

      if (req.url === '/health' || req.url === '/health/ready') {
        const memory = process.memoryUsage();
        const limitMb = Number.parseInt(process.env.WORKER_MEMORY_LIMIT_MB ?? '2048', 10);
        const rssMb = Math.round(memory.rss / (1024 * 1024));

        const checks: Record<string, { status: 'up' | 'down'; error?: string }> = {};

        if (state.redis) {
          try {
            const pong = await state.redis.ping();
            checks.redis = { status: pong === 'PONG' ? 'up' : 'down' };
          } catch (error) {
            checks.redis = { status: 'down', error: (error as Error).message };
          }
        } else {
          checks.redis = { status: 'down', error: 'not configured' };
        }

        try {
          await getPrisma().$queryRaw`SELECT 1`;
          checks.database = { status: 'up' };
        } catch (error) {
          checks.database = { status: 'down', error: (error as Error).message };
        }

        try {
          const client = new S3Client({
            endpoint: getMinioEndpoint(),
            region: process.env.MINIO_REGION ?? 'us-east-1',
            forcePathStyle: true,
            credentials: {
              accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
              secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
            },
          });
          await client.send(new HeadBucketCommand({ Bucket: getMinioBucket() }));
          checks.minio = { status: 'up' };
        } catch (error) {
          checks.minio = { status: 'down', error: (error as Error).message };
        }

        const deepOk = Object.values(checks).every((c) => c.status === 'up');
        const readyOk = req.url === '/health/ready' ? deepOk : true;
        const statusCode = readyOk ? 200 : 503;

        const body = {
          status: readyOk ? 'ok' : 'degraded',
          service: 'worker',
          environment: process.env.NODE_ENV ?? 'development',
          version: process.env.APP_VERSION ?? '0.1.0',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
          ffmpegAvailable: state.ffmpegAvailable,
          queues: state.workers.map((w) => w.name),
          checks,
          memory: {
            rssMb,
            heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
            limitMb,
            pressure: rssMb >= limitMb * 0.9,
          },
        };
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }

      res.writeHead(404);
      res.end();
    })().catch((error) => {
      logger.error({ err: error }, 'Health handler error');
      res.writeHead(500);
      res.end('error');
    });
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Worker health server listening');
  });

  return server;
}
