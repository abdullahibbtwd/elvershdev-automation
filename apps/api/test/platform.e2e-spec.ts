import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedAndLogin } from './helpers/auth-fixtures';
import { MediaService } from '../src/modules/media/media.service';
import { spawnWorkerProcess } from './spawn-worker';

describe('Platform Phase 3 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mediaService: MediaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';

  const password = 'Str0ngPass1';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    mediaService = app.get(MediaService);

    worker = spawnWorkerProcess(process.env);

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }, 60_000);

  beforeEach(async () => {
    await prisma.characterVisualReference.deleteMany();
    await prisma.sceneVisual.deleteMany();
    await prisma.providerUsage.deleteMany();
    await prisma.storyGeneration.deleteMany();
    await prisma.storyScene.deleteMany();
    await prisma.characterProfile.deleteMany();
    await prisma.publishRecord.deleteMany();
    await prisma.generationJob.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.videoProject.deleteMany();
    await prisma.story.deleteMany();
    await prisma.visualStyle.deleteMany({ where: { isSystem: false } });
    await prisma.socialChannel.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.user.deleteMany();

    const userA = await seedAndLogin(app, prisma, {
      name: 'User A',
      email: 'a@example.com',
      password: password,
    });
    const userB = await seedAndLogin(app, prisma, {
      name: 'User B',
      email: 'b@example.com',
      password: password,
    });

    accessTokenA = userA.body.data.accessToken;
    accessTokenB = userB.body.data.accessToken;
  });

  afterAll(async () => {
    if (worker) {
      worker.kill('SIGTERM');
    }
    await app.close();
  });

  async function waitForJobStatus(jobId: string, status: string, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessTokenA}`);
      if (res.body?.data?.status === status) {
        return res.body.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for job ${jobId} to become ${status}`);
  }

  it('creates projects with ownership isolation', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        title: 'Launch film',
        description: 'First project',
        duration: 45,
        aspectRatio: '9:16',
        targetPlatforms: ['TIKTOK', 'YOUTUBE'],
      })
      .expect(201);

    expect(created.body.data.title).toBe('Launch film');

    await request(app.getHttpServer())
      .get(`/api/projects/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    const listB = await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(200);

    expect(listB.body.data).toHaveLength(0);
  });

  it('supports story CRUD', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ title: 'Draft story', content: 'Once upon a time', status: 'DRAFT' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/stories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ title: 'Ready story', status: 'READY' })
      .expect(200);

    expect(updated.body.data.title).toBe('Ready story');
    expect(updated.body.data.status).toBe('READY');

    await request(app.getHttpServer())
      .get(`/api/stories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/stories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
  });

  it('uploads media and returns temporary download URLs', async () => {
    await expect(mediaService.checkConnectivity()).resolves.toBe(true);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = await request(app.getHttpServer())
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .attach('file', png, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(201);

    expect(uploaded.body.data.type).toBe('IMAGE');
    expect(uploaded.body.data.storageKey).toContain('users/');

    const download = await request(app.getHttpServer())
      .get(`/api/media/${uploaded.body.data.id}/download-url`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(download.body.data.url).toContain('http');
    expect(download.body.data.expiresIn).toBe(900);

    await request(app.getHttpServer())
      .get(`/api/media/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);
  });

  it('creates, processes, fails and retries jobs', async () => {
    const ok = await request(app.getHttpServer())
      .post('/api/jobs')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ jobType: 'STORY', provider: 'placeholder', estimatedCost: 0.1 })
      .expect(201);

    expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(ok.body.data.status);

    const completed = await waitForJobStatus(ok.body.data.id, 'COMPLETED');
    expect(completed.progress).toBe(100);

    const failing = await request(app.getHttpServer())
      .post('/api/jobs')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        jobType: 'IMAGE',
        provider: 'placeholder',
        simulateFailure: true,
      })
      .expect(201);

    const failed = await waitForJobStatus(failing.body.data.id, 'FAILED', 30_000);
    expect(failed.errorMessage).toContain('Simulated failure');

    const retried = await request(app.getHttpServer())
      .post(`/api/jobs/${failed.id}/retry`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(retried.body.data.status);
  }, 60_000);

  it('rejects unauthorized resource access', async () => {
    await request(app.getHttpServer()).get('/api/projects').expect(401);
    await request(app.getHttpServer()).get('/api/stories').expect(401);
    await request(app.getHttpServer()).get('/api/media').expect(401);
    await request(app.getHttpServer()).get('/api/jobs').expect(401);
    await request(app.getHttpServer()).get('/api/channels').expect(401);
  });
});
