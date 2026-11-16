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

describe('Motion AI Phase 6 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.FAL_USE_MOCK = 'true';
    process.env.VIDEO_GENERATION_PROVIDER = 'hailuo';
    process.env.HAILUO_USE_MOCK = 'true';
    process.env.HAILUO_MOCK_READY_AFTER_MS = '500';
    process.env.HAILUO_POLL_INTERVAL_SECONDS = '1';
    process.env.KLING_ENABLED = 'false';
    process.env.KLING_USE_MOCK = 'true';
    process.env.KLING_MOCK_READY_AFTER_MS = '500';
    process.env.KLING_POLL_INTERVAL_SECONDS = '1';
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
    worker = spawnWorkerProcess({
      ...process.env,
      GEMINI_USE_MOCK: 'true',
      FAL_USE_MOCK: 'true',
      VIDEO_GENERATION_PROVIDER: 'hailuo',
      HAILUO_USE_MOCK: 'true',
      HAILUO_MOCK_READY_AFTER_MS: '500',
      HAILUO_POLL_INTERVAL_SECONDS: '1',
      KLING_ENABLED: 'false',
      KLING_USE_MOCK: 'true',
      KLING_MOCK_READY_AFTER_MS: '500',
      KLING_POLL_INTERVAL_SECONDS: '1',
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }, 60_000);

  beforeEach(async () => {
    await prisma.motionGeneration.deleteMany();
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
      name: 'Motion A',
      email: 'motion-a@example.com',
      password: password,
    });
    const userB = await seedAndLogin(app, prisma, {
      name: 'Motion B',
      email: 'motion-b@example.com',
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

  async function createReadyStory(token = accessTokenA, timeoutMs = 45_000) {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        topic: 'A quiet morning in the pottery studio',
        niche: 'Motivation',
        targetAudience: 'Creators',
        language: 'en',
        tone: 'Cinematic',
        desiredDurationSeconds: 45,
        category: 'Narrative',
      })
      .expect(201);

    const storyId = queued.body.data.story.id as string;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body?.data?.status === 'READY') {
        return res.body.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`Timed out waiting for story ${storyId}`);
  }

  async function waitForVisuals(storyId: string, token = accessTokenA, timeoutMs = 75_000) {
    await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/visuals/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ skipCharacterReferences: true })
      .expect(201);

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}/visuals/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = res.body.data;
      if (
        data.totalScenes > 0 &&
        data.completedScenes === data.totalScenes &&
        data.activeJobs.length === 0
      ) {
        return data;
      }
      if (data.failedScenes > 0 && data.activeJobs.length === 0) {
        throw new Error(`Visuals failed for story ${storyId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for visuals on ${storyId}`);
  }

  async function waitForMotionProgress(
    storyId: string,
    token = accessTokenA,
    timeoutMs = 90_000,
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}/motion/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = res.body.data;
      const busy =
        (data.countsByStatus?.PENDING ?? 0) +
          (data.countsByStatus?.ANALYZING ?? 0) +
          (data.countsByStatus?.SUBMITTING ?? 0) +
          (data.countsByStatus?.PROCESSING ?? 0) +
          (data.countsByStatus?.DOWNLOADING ?? 0) +
          (data.countsByStatus?.VALIDATING ?? 0) >
        0;
      if (
        data.totalScenes > 0 &&
        data.completedScenes === data.totalScenes &&
        data.activeJobs.length === 0 &&
        !busy
      ) {
        return data;
      }
      if (data.failedScenes > 0 && data.activeJobs.length === 0 && !busy) {
        throw new Error(`Motion generation failed for story ${storyId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    throw new Error(`Timed out waiting for motion on ${storyId}`);
  }

  it('rejects motion generation when scenes have no source images', async () => {
    const story = await createReadyStory();
    const res = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/motion/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(400);
    const message = String(res.body?.error?.message ?? res.body?.message ?? '');
    expect(message).toMatch(/generated image/i);
  }, 60_000);

  it('completes mock story motion pipeline, history, selection, regenerate, retry, cancel, and ownership isolation', async () => {
    const story = await createReadyStory();
    await waitForVisuals(story.id);

    const unauthorized = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/motion/generate`)
      .send({});
    expect(unauthorized.status).toBe(401);

    const foreign = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/motion`)
      .set('Authorization', `Bearer ${accessTokenB}`);
    expect(foreign.status).toBe(404);

    const queued = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/motion/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ provider: 'hailuo', durationSeconds: 6, resolution: '768P' })
      .expect(201);

    expect(queued.body.data.job.jobType).toBe('MOTION_ANALYSIS');
    expect(queued.body.data.motionGenerations.length).toBe(story.scenes.length);
    expect(queued.body.data.motionGenerations[0].provider).toBe('hailuo');

    const progress = await waitForMotionProgress(story.id);
    expect(progress.percentComplete).toBe(100);
    expect(progress.completedScenes).toBe(story.scenes.length);

    const list = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/motion`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(list.body.data.scenes).toHaveLength(story.scenes.length);
    for (const scene of list.body.data.scenes) {
      expect(scene.hasSourceImage).toBe(true);
      expect(scene.motions.length).toBeGreaterThanOrEqual(1);
      const selected = scene.motions.find((m: { isSelected: boolean }) => m.isSelected);
      expect(selected.status).toBe('COMPLETED');
      expect(selected.downloadUrl).toContain('http');
      expect(selected.provider).toBe('hailuo');
      expect(selected.providerModel).toContain('mock:');
    }

    const usages = await prisma.providerUsage.findMany({ where: { storyId: story.id } });
    expect(usages.some((u) => u.requestType === 'motion_analysis')).toBe(true);
    expect(usages.some((u) => u.provider === 'hailuo')).toBe(true);

    const firstSceneId = story.scenes[0].id as string;
    const sceneMotions = await request(app.getHttpServer())
      .get(`/api/scenes/${firstSceneId}/motion`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(sceneMotions.body.data.length).toBeGreaterThanOrEqual(1);

    const firstMotionId = sceneMotions.body.data[0].id as string;
    await request(app.getHttpServer())
      .patch(`/api/motion/${firstMotionId}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ motionPrompt: 'Updated gentle head turn toward the window' })
      .expect(200);

    const regenerated = await request(app.getHttpServer())
      .post(`/api/scenes/${firstSceneId}/motion/regenerate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        motionPrompt: 'Slow cinematic push-in, restrained motion',
        skipAnalysis: true,
      })
      .expect(201);

    expect(regenerated.body.data.motion.attemptNumber).toBeGreaterThan(1);

    // Wait for the regenerated clip
    const started = Date.now();
    let secondClip: { id: string; status: string } | undefined;
    while (Date.now() - started < 90_000) {
      const res = await request(app.getHttpServer())
        .get(`/api/scenes/${firstSceneId}/motion`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .expect(200);
      secondClip = res.body.data.find(
        (m: { attemptNumber: number; status: string }) =>
          m.attemptNumber === regenerated.body.data.motion.attemptNumber,
      );
      if (secondClip?.status === 'COMPLETED' || secondClip?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    expect(secondClip?.status).toBe('COMPLETED');

    await request(app.getHttpServer())
      .post(`/api/motion/${firstMotionId}/select`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const selectedList = await request(app.getHttpServer())
      .get(`/api/scenes/${firstSceneId}/motion`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    const selected = selectedList.body.data.find((m: { id: string }) => m.id === firstMotionId);
    expect(selected.isSelected).toBe(true);

    // Simulate failure then retry
    const failing = await request(app.getHttpServer())
      .post(`/api/scenes/${firstSceneId}/motion/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ simulateFailure: true, skipAnalysis: true })
      .expect(201);

    const failingMotionId = failing.body.data.motion.id as string;
    const failStarted = Date.now();
    while (Date.now() - failStarted < 45_000) {
      const motion = await prisma.motionGeneration.findUnique({ where: { id: failingMotionId } });
      if (motion?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const failedMotion = await prisma.motionGeneration.findUnique({
      where: { id: failingMotionId },
    });
    expect(failedMotion?.status).toBe('FAILED');

    const retried = await request(app.getHttpServer())
      .post(`/api/motion/${failingMotionId}/retry`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);
    expect(retried.body.data.motion.id).not.toBe(failingMotionId);

    // Cancel an eligible pending/in-progress job (may already be mid-pipeline in mock mode).
    const cancellable = await request(app.getHttpServer())
      .post(`/api/scenes/${story.scenes[1]?.id || firstSceneId}/motion/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ skipAnalysis: true })
      .expect(201);
    const cancelId = cancellable.body.data.motion.id as string;
    const cancelRes = await request(app.getHttpServer())
      .post(`/api/motion/${cancelId}/cancel`)
      .set('Authorization', `Bearer ${accessTokenA}`);
    if (cancelRes.status === 201) {
      expect(cancelRes.body.data.status).toBe('CANCELLED');
    } else {
      // Mock pipeline can finish before cancel reaches an eligible state.
      expect(cancelRes.status).toBe(409);
    }
  }, 240_000);
});
