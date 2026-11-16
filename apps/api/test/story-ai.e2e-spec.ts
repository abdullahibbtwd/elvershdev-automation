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
import { spawnWorkerProcess } from './spawn-worker';

describe('Story AI Phase 4 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.NODE_ENV = 'test';

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
      email: 'story-a@example.com',
      password: password,
    });
    const userB = await seedAndLogin(app, prisma, {
      name: 'User B',
      email: 'story-b@example.com',
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

  async function waitForStoryStatus(storyId: string, status: string, timeoutMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}`)
        .set('Authorization', `Bearer ${accessTokenA}`);
      if (res.body?.data?.status === status) {
        return res.body.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for story ${storyId} to become ${status}`);
  }

  it('generates a story, plans scenes, and tracks usage with mocks', async () => {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        topic: 'The night a creator decided to ship anyway',
        niche: 'Motivation',
        targetAudience: 'Creators',
        language: 'en',
        tone: 'Inspirational',
        desiredDurationSeconds: 60,
        category: 'Narrative',
      })
      .expect(201);

    expect(queued.body.data.story.status).toBe('GENERATING');
    expect(queued.body.data.job.status).toBe('QUEUED');

    const ready = await waitForStoryStatus(queued.body.data.story.id, 'READY', 45_000);
    expect(ready.title).toBeTruthy();
    expect(ready.narrationScript).toBeTruthy();
    expect(ready.scenes.length).toBeGreaterThan(0);
    expect(ready.characters.length).toBeGreaterThan(0);

    const characterName = ready.characters[0].name as string;
    for (const scene of ready.scenes) {
      expect(scene.characterConsistencyInstructions).toContain(characterName);
    }

    const totalDuration = ready.scenes.reduce(
      (sum: number, scene: { durationSeconds: number }) => sum + scene.durationSeconds,
      0,
    );
    expect(Math.abs(totalDuration - 60) / 60).toBeLessThanOrEqual(0.15);

    expect(ready.providerUsages.length).toBeGreaterThan(0);
    expect(ready.providerUsages[0].model).toBe('mock-gemini');
  }, 60_000);

  it('isolates story AI data between users', async () => {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        topic: 'Private founder story',
        niche: 'Business',
        targetAudience: 'Founders',
        tone: 'Educational',
        desiredDurationSeconds: 45,
        category: 'Explainer',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/stories/${queued.body.data.story.id}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/stories/${queued.body.data.story.id}/regenerate`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({})
      .expect(404);
  });

  it('prevents duplicate active generation jobs', async () => {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        topic: 'Duplicate protection story',
        niche: 'Technology',
        targetAudience: 'Builders',
        tone: 'Urgent',
        desiredDurationSeconds: 30,
        category: 'Short-form social',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/stories/${queued.body.data.story.id}/regenerate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(409);
  });

  it('handles failed generation via simulated job failure', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        title: 'Failing story',
        content: 'Seed content for failure path',
        status: 'DRAFT',
        topic: 'Failure path',
        niche: 'Technology',
        targetAudience: 'Engineers',
        tone: 'Calm',
        category: 'Explainer',
        targetDurationSeconds: 30,
        narrationScript: 'Seed narration',
      })
      .expect(201);

    const failing = await request(app.getHttpServer())
      .post('/api/jobs')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        jobType: 'STORY',
        storyId: draft.body.data.id,
        provider: 'gemini',
        simulateFailure: true,
        payload: {
          action: 'generate_story',
          brief: {
            topic: 'Failure path',
            niche: 'Technology',
            targetAudience: 'Engineers',
            language: 'en',
            tone: 'Calm',
            desiredDurationSeconds: 30,
            category: 'Explainer',
          },
        },
      })
      .expect(201);

    const started = Date.now();
    let failedJob: { status: string; errorMessage?: string } | undefined;
    while (Date.now() - started < 30_000) {
      const res = await request(app.getHttpServer())
        .get(`/api/jobs/${failing.body.data.id}`)
        .set('Authorization', `Bearer ${accessTokenA}`);
      if (res.body?.data?.status === 'FAILED') {
        failedJob = res.body.data;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    expect(failedJob?.status).toBe('FAILED');
    expect(failedJob?.errorMessage).toContain('Simulated failure');
  }, 45_000);

  it('attaches a ready story to a new video project', async () => {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        topic: 'Attach me to a project',
        niche: 'Lifestyle',
        targetAudience: 'Viewers',
        tone: 'Calm',
        desiredDurationSeconds: 30,
        category: 'Narrative',
      })
      .expect(201);

    const ready = await waitForStoryStatus(queued.body.data.story.id, 'READY', 45_000);

    const attached = await request(app.getHttpServer())
      .post(`/api/stories/${ready.id}/attach-project`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ projectTitle: 'From story AI' })
      .expect(201);

    expect(attached.body.data.storyId).toBe(ready.id);
    expect(attached.body.data.title).toBe('From story AI');
  }, 60_000);
});
