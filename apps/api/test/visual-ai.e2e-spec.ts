import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { spawnWorkerProcess } from './spawn-worker';

describe('Visual AI Phase 5 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.FAL_USE_MOCK = 'true';
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

    const userA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'User A', email: 'visual-a@example.com', password })
      .expect(201);
    const userB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'User B', email: 'visual-b@example.com', password })
      .expect(201);

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
        topic: 'A visual journey through dawn in the workshop',
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
    throw new Error(`Timed out waiting for story ${storyId} to become READY`);
  }

  async function waitForVisualProgressComplete(
    storyId: string,
    token = accessTokenA,
    timeoutMs = 60_000,
  ) {
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
        throw new Error(`Visual generation failed for story ${storyId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for story ${storyId} visuals to complete`);
  }

  async function waitForVisualJobStatus(
    jobId: string,
    statuses: string[],
    token = accessTokenA,
    timeoutMs = 45_000,
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      // Prefer the shared jobs endpoint; visual-generation wrapper is also covered below.
      const res = await request(app.getHttpServer())
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status === 200 && statuses.includes(res.body.data.status)) {
        return res.body.data;
      }
      if (res.status === 200 && res.body.data.status === 'FAILED' && !statuses.includes('FAILED')) {
        throw new Error(
          `Visual job ${jobId} failed: ${res.body.data.errorMessage ?? 'unknown error'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(
      `Timed out waiting for visual job ${jobId} to reach ${statuses.join(',')}`,
    );
  }

  it('runs full mock story visual generation pipeline, retrieves visuals, and tracks progress without real APIs', async () => {
    const story = await createReadyStory();
    expect(story.scenes.length).toBeGreaterThan(0);
    expect(story.characters.length).toBeGreaterThan(0);

    const stylesRes = await request(app.getHttpServer())
      .get('/api/visual-styles')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(stylesRes.body.data.length).toBeGreaterThan(0);

    const queued = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/visuals/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(201);

    expect(queued.body.data.job.jobType).toBe('VISUAL_ANALYSIS');
    expect(queued.body.data.job.status).toBe('QUEUED');

    const progress = await waitForVisualProgressComplete(story.id, accessTokenA, 75_000);
    expect(progress.percentComplete).toBe(100);
    expect(progress.completedScenes).toBe(story.scenes.length);
    expect(progress.charactersWithReferences).toBe(story.characters.length);

    const visualsRes = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/visuals`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    const visuals = visualsRes.body.data;
    expect(visuals.storyId).toBe(story.id);
    expect(visuals.scenes).toHaveLength(story.scenes.length);
    for (const scene of visuals.scenes) {
      expect(scene.visuals.length).toBeGreaterThanOrEqual(1);
      const selected = scene.visuals.find((v: { isSelected: boolean }) => v.isSelected);
      expect(selected).toBeDefined();
      expect(selected.generationStatus).toBe('COMPLETED');
      expect(selected.provider).toBe('fal');
      expect(selected.providerModel).toContain('mock:');
      expect(selected.generatedImageMedia).toBeTruthy();
      expect(selected.downloadUrl).toContain('http');
    }

    expect(visuals.characters.length).toBe(story.characters.length);
    expect(visuals.characters[0].visualReferences.length).toBeGreaterThanOrEqual(1);
    expect(visuals.characters[0].visualReferences[0].isPrimary).toBe(true);
    expect(visuals.characters[0].visualReferences[0].downloadUrl).toContain('http');

    // Verify ProviderUsage rows use mock models
    const usages = await prisma.providerUsage.findMany({
      where: { storyId: story.id },
    });
    expect(usages.some((u) => u.provider === 'gemini' && u.model === 'mock-gemini')).toBe(true);
    expect(usages.some((u) => u.provider === 'fal' && u.model.startsWith('mock:'))).toBe(true);
  }, 120_000);

  it('generates and regenerates a single scene image and updates selection', async () => {
    const story = await createReadyStory();
    const firstSceneId = story.scenes[0].id as string;

    const generated = await request(app.getHttpServer())
      .post(`/api/scenes/${firstSceneId}/visuals/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        visualPrompt: 'Close-up of artisan hands sketching at sunrise, photorealistic 9:16',
      })
      .expect(201);

    expect(generated.body.data.sceneVisual.attemptNumber).toBe(1);
    const firstJobId = generated.body.data.job.id as string;
    const doneFirst = await waitForVisualJobStatus(firstJobId, ['COMPLETED']);
    expect(doneFirst.status).toBe('COMPLETED');

    const regenerated = await request(app.getHttpServer())
      .post(`/api/scenes/${firstSceneId}/visuals/regenerate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        visualPrompt: 'Wide cinematic shot of the workshop illuminated by amber light',
      })
      .expect(201);

    expect(regenerated.body.data.sceneVisual.attemptNumber).toBe(2);
    const secondJobId = regenerated.body.data.job.id as string;
    const doneSecond = await waitForVisualJobStatus(secondJobId, ['COMPLETED']);
    expect(doneSecond.status).toBe('COMPLETED');

    const sceneVisualsRes = await request(app.getHttpServer())
      .get(`/api/scenes/${firstSceneId}/visuals`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    const attempts = sceneVisualsRes.body.data;
    expect(attempts).toHaveLength(2);
    const attempt2 = attempts.find((a: { attemptNumber: number }) => a.attemptNumber === 2);
    const attempt1 = attempts.find((a: { attemptNumber: number }) => a.attemptNumber === 1);
    expect(attempt2.isSelected).toBe(true);
    expect(attempt1.isSelected).toBe(false);
    expect(attempt2.downloadUrl).toContain('http');
  }, 90_000);

  it('handles simulated visual generation failure and retries the failed job', async () => {
    const story = await createReadyStory();
    const firstSceneId = story.scenes[0].id as string;

    const failing = await request(app.getHttpServer())
      .post(`/api/scenes/${firstSceneId}/visuals/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        visualPrompt: 'Prompt that will fail on first attempt',
        simulateFailure: true,
      })
      .expect(201);

    const jobId = failing.body.data.job.id as string;
    const failedJob = await waitForVisualJobStatus(jobId, ['FAILED']);
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.errorMessage).toContain('Simulated failure');

    // Clear simulateFailure in payload so retry succeeds via mock worker
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        payload: {
          ...(failedJob.payload as Record<string, unknown>),
          simulateFailure: false,
        },
      },
    });

    const retried = await request(app.getHttpServer())
      .post(`/api/visual-generation/jobs/${jobId}/retry`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(retried.body.data.status);

    const completedJob = await waitForVisualJobStatus(jobId, ['COMPLETED']);
    expect(completedJob.status).toBe('COMPLETED');
    expect(completedJob.progress).toBe(100);
  }, 90_000);

  it('generates a character visual reference portrait on demand', async () => {
    const story = await createReadyStory();
    const characterId = story.characters[0].id as string;

    const triggered = await request(app.getHttpServer())
      .post(`/api/characters/${characterId}/visual-reference/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ force: true })
      .expect(201);

    expect(triggered.body.data.characterId).toBe(characterId);
    expect(triggered.body.data.job.jobType).toBe('CHARACTER_REFERENCE');

    const completed = await waitForVisualJobStatus(
      triggered.body.data.job.id as string,
      ['COMPLETED'],
    );
    expect(completed.status).toBe('COMPLETED');

    const visualsRes = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/visuals`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    const char = visualsRes.body.data.characters.find(
      (c: { id: string }) => c.id === characterId,
    );
    expect(char.visualReferences.length).toBeGreaterThanOrEqual(1);
    expect(char.visualReferences[0].isPrimary).toBe(true);
    expect(char.visualReferences[0].mediaAsset.type).toBe('IMAGE');
    expect(char.visualReferences[0].downloadUrl).toContain('http');
  }, 90_000);

  it('enforces user ownership isolation across visual endpoints', async () => {
    const story = await createReadyStory(accessTokenA);
    const sceneId = story.scenes[0].id as string;
    const characterId = story.characters[0].id as string;

    await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/visuals`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/visuals/progress`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/visuals/generate`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({})
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/scenes/${sceneId}/visuals/generate`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({})
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/characters/${characterId}/visual-reference/generate`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({})
      .expect(404);
  }, 60_000);

  it('rejects unauthorized access without a bearer token', async () => {
    const fakeId = '11111111-1111-4111-8111-111111111111';

    await request(app.getHttpServer())
      .get(`/api/stories/${fakeId}/visuals`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/stories/${fakeId}/visuals/progress`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/stories/${fakeId}/visuals/generate`)
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/scenes/${fakeId}/visuals/generate`)
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/scenes/${fakeId}/visuals/regenerate`)
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/characters/${fakeId}/visual-reference/generate`)
      .send({})
      .expect(401);

    await request(app.getHttpServer()).get('/api/visual-styles').expect(401);
  });
});
