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

describe('Voice AI Phase 7 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.GEMINI_TTS_USE_MOCK = 'true';
    process.env.FAL_USE_MOCK = 'true';
    process.env.KLING_USE_MOCK = 'true';
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
      GEMINI_TTS_USE_MOCK: 'true',
      FAL_USE_MOCK: 'true',
      KLING_USE_MOCK: 'true',
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }, 60_000);

  beforeEach(async () => {
    await prisma.audioGeneration.deleteMany();
    await prisma.sceneNarration.deleteMany();
    await prisma.narrationScript.deleteMany();
    await prisma.voiceProfile.deleteMany();
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
      name: 'Voice A',
      email: 'voice-a@example.com',
      password: password,
    });
    const userB = await seedAndLogin(app, prisma, {
      name: 'Voice B',
      email: 'voice-b@example.com',
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

  async function waitForNarrationReady(storyId: string, token = accessTokenA, timeoutMs = 60_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}/narration`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const script = res.body.data.narrationScript;
      if (script?.status === 'READY' || script?.status === 'APPROVED') {
        return res.body.data;
      }
      if (script?.status === 'FAILED') {
        throw new Error(`Narration planning failed: ${script.errorMessage}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for narration script on story ${storyId}`);
  }

  async function waitForAudioComplete(storyId: string, token = accessTokenA, timeoutMs = 90_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/stories/${storyId}/narration/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = res.body.data;
      const active =
        (data.activeJobs?.length ?? 0) > 0 ||
        Object.entries(data.countsByStatus || {}).some(([status, count]) =>
          ['PENDING', 'GENERATING', 'VALIDATING', 'STORING'].includes(status) &&
          Number(count) > 0,
        );
      if (
        data.totalScenes > 0 &&
        data.completedScenes === data.totalScenes &&
        !active
      ) {
        return data;
      }
      if (data.failedScenes > 0 && !active) {
        throw new Error(`Audio generation failed for story ${storyId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for audio on story ${storyId}`);
  }

  it('lists official Gemini prebuilt voices without fabricated previews', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/voices')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toBe('gemini');
    expect(res.body.data.voices.length).toBe(30);
    expect(res.body.data.voices[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
      }),
    );
    expect(res.body.data.voices[0].previewAudioBase64).toBeUndefined();
  });

  it('enforces voice profile ownership', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/voice-profiles')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        name: 'Default Narrator',
        providerVoiceId: 'Kore',
        language: 'en',
        isDefault: true,
        configuration: { speakingStyle: 'calm and measured' },
      })
      .expect(201);

    const profileId = created.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/voice-profiles/${profileId}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/voice-profiles/${profileId}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);
  });

  it('plans, edits, approves, and generates mock narration audio end-to-end', async () => {
    const story = await createReadyStory();
    const storyId = story.id as string;

    await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/narration/plan`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(201);

    const narration = await waitForNarrationReady(storyId);
    const script = narration.narrationScript;
    expect(script.status).toBe('READY');
    expect(script.scenes.length).toBeGreaterThan(0);

    const firstScene = script.scenes[0];
    const editedText = `${firstScene.text} And then the clay found its shape.`;

    await request(app.getHttpServer())
      .patch(`/api/narration/${script.id}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        scenes: [{ id: firstScene.id, text: editedText }],
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/narration/${script.id}/approve`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const profile = await request(app.getHttpServer())
      .post('/api/voice-profiles')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        name: 'Story Voice',
        providerVoiceId: 'Puck',
        language: 'en',
        isDefault: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/narration/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ voiceProfileId: profile.body.data.id })
      .expect(201);

    await waitForAudioComplete(storyId);

    const audioList = await request(app.getHttpServer())
      .get(`/api/stories/${storyId}/audio`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(audioList.body.data.length).toBeGreaterThan(0);
    const completed = audioList.body.data.filter((a: { status: string }) => a.status === 'COMPLETED');
    expect(completed.length).toBeGreaterThan(0);
    expect(completed[0].downloadUrl).toMatch(/^https?:\/\//);
    expect(completed[0].durationSeconds).toBeGreaterThan(0);
    expect(completed[0].format).toBe('wav');

    const usage = await prisma.providerUsage.findMany({
      where: {
        storyId,
        requestType: { in: ['narration_planning', 'speech_generation'] },
      },
    });
    expect(usage.some((u) => u.requestType === 'narration_planning')).toBe(true);
    expect(usage.some((u) => u.requestType === 'speech_generation')).toBe(true);

    // Scene-level regenerate path
    const sceneId = firstScene.sceneId as string;
    await request(app.getHttpServer())
      .post(`/api/scenes/${sceneId}/narration/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ voiceProfileId: profile.body.data.id, forceRegenerate: true })
      .expect(201);

    const sceneAudioStarted = Date.now();
    let selectedId = '';
    while (Date.now() - sceneAudioStarted < 60_000) {
      const sceneAudio = await request(app.getHttpServer())
        .get(`/api/scenes/${sceneId}/audio`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .expect(200);
      const items = sceneAudio.body.data as Array<{
        id: string;
        status: string;
        isSelected: boolean;
      }>;
      const done = items.filter((item) => item.status === 'COMPLETED');
      if (done.length >= 2) {
        selectedId = done.find((item) => !item.isSelected)?.id || done[0].id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    expect(selectedId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/audio/${selectedId}/select`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const selected = await request(app.getHttpServer())
      .get(`/api/audio/${selectedId}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(selected.body.data.isSelected).toBe(true);

    // Ownership isolation
    await request(app.getHttpServer())
      .get(`/api/stories/${storyId}/narration`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);
  }, 180_000);

  it('enforces monthly TTS budget limits', async () => {
    process.env.GEMINI_TTS_MAX_MONTHLY_SPEND_USD = '0.000001';
    const story = await createReadyStory();
    const storyId = story.id as string;

    await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/narration/plan`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(201);
    const narration = await waitForNarrationReady(storyId);
    await request(app.getHttpServer())
      .post(`/api/narration/${narration.narrationScript.id}/approve`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/narration/generate`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ providerVoiceId: 'Kore' })
      .expect(400);

    delete process.env.GEMINI_TTS_MAX_MONTHLY_SPEND_USD;
  }, 120_000);
});
