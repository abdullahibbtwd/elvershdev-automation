import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  AudioGenerationStatus,
  MediaType,
  MotionGenerationStatus,
  NarrationScriptStatus,
  SceneNarrationStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedAndLogin } from './helpers/auth-fixtures';
import {
  cleanupFixtures,
  createRenderFixtures,
  uploadFixtureToMinio,
} from './helpers/ffmpeg-fixtures';
import { spawnWorkerProcess } from './spawn-worker';

describe('Video Render Phase 8 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let accessTokenA = '';
  let accessTokenB = '';
  let fixturesDir = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.GEMINI_TTS_USE_MOCK = 'true';
    process.env.FAL_USE_MOCK = 'true';
    process.env.KLING_USE_MOCK = 'true';
    process.env.NODE_ENV = 'test';
    process.env.VIDEO_RENDER_MAX_CONCURRENCY = '1';

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
      VIDEO_RENDER_MAX_CONCURRENCY: '1',
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }, 60_000);

  beforeEach(async () => {
    if (fixturesDir) {
      await cleanupFixtures(fixturesDir);
      fixturesDir = '';
    }

    await prisma.videoRenderScene.deleteMany();
    await prisma.videoRender.deleteMany();
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
      name: 'Render A',
      email: 'render-a@example.com',
      password: password,
    });
    const userB = await seedAndLogin(app, prisma, {
      name: 'Render B',
      email: 'render-b@example.com',
      password: password,
    });

    accessTokenA = userA.body.data.accessToken;
    accessTokenB = userB.body.data.accessToken;
  });

  afterAll(async () => {
    if (fixturesDir) await cleanupFixtures(fixturesDir);
    if (worker) worker.kill('SIGTERM');
    await app.close();
  });

  async function createReadyStory(token = accessTokenA, timeoutMs = 45_000) {
    const queued = await request(app.getHttpServer())
      .post('/api/stories/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        topic: 'Sunrise over terracotta rooftops',
        niche: 'Travel',
        targetAudience: 'Creators',
        language: 'en',
        tone: 'Cinematic',
        desiredDurationSeconds: 20,
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

  async function seedPhaseAssets(story: {
    id: string;
    userId?: string;
    scenes: Array<{ id: string; sceneNumber: number; narration: string }>;
  }) {
    const user = await prisma.user.findFirst({ where: { email: 'render-a@example.com' } });
    if (!user) throw new Error('user missing');

    // Keep 2 scenes for a practical multi-scene render; remove extras so readiness passes.
    const ordered = [...story.scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const keepIds = new Set(ordered.slice(0, 2).map((s) => s.id));
    const extraIds = ordered.filter((s) => !keepIds.has(s.id)).map((s) => s.id);
    if (extraIds.length) {
      await prisma.storyScene.deleteMany({ where: { id: { in: extraIds } } });
    }
    const scenes = ordered.slice(0, 2);
    const sceneCount = scenes.length;
    const fixtures = await createRenderFixtures(sceneCount);
    fixturesDir = fixtures.dir;

    const script = await prisma.narrationScript.create({
      data: {
        userId: user.id,
        storyId: story.id,
        version: 1,
        status: NarrationScriptStatus.APPROVED,
        fullText: scenes.map((s) => s.narration).join('\n'),
        approvedAt: new Date(),
      },
    });

    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      const imageKey = `users/${user.id}/stories/${story.id}/fixtures/scene-${scene.sceneNumber}.png`;
      const videoKey = `users/${user.id}/stories/${story.id}/fixtures/scene-${scene.sceneNumber}.mp4`;
      const audioKey = `users/${user.id}/stories/${story.id}/fixtures/scene-${scene.sceneNumber}.wav`;

      await uploadFixtureToMinio(imageKey, fixtures.images[i], 'image/png');
      await uploadFixtureToMinio(videoKey, fixtures.videos[i], 'video/mp4');
      await uploadFixtureToMinio(audioKey, fixtures.wavs[i], 'audio/wav');

      const imageAsset = await prisma.mediaAsset.create({
        data: {
          userId: user.id,
          type: MediaType.IMAGE,
          storageKey: imageKey,
          originalName: `scene-${scene.sceneNumber}.png`,
          mimeType: 'image/png',
        },
      });
      const videoAsset = await prisma.mediaAsset.create({
        data: {
          userId: user.id,
          type: MediaType.VIDEO,
          storageKey: videoKey,
          originalName: `scene-${scene.sceneNumber}.mp4`,
          mimeType: 'video/mp4',
        },
      });
      const audioAsset = await prisma.mediaAsset.create({
        data: {
          userId: user.id,
          type: MediaType.AUDIO,
          storageKey: audioKey,
          originalName: `scene-${scene.sceneNumber}.wav`,
          mimeType: 'audio/wav',
        },
      });

      const visual = await prisma.sceneVisual.create({
        data: {
          sceneId: scene.id,
          visualPrompt: `Fixture visual for scene ${scene.sceneNumber}`,
          generationStatus: VisualGenerationStatus.COMPLETED,
          generatedImageMediaId: imageAsset.id,
          isSelected: true,
        },
      });

      await prisma.motionGeneration.create({
        data: {
          userId: user.id,
          storyId: story.id,
          sceneId: scene.id,
          sourceVisualId: visual.id,
          sourceMediaAssetId: imageAsset.id,
          motionPrompt: `Fixture motion for scene ${scene.sceneNumber}`,
          status: MotionGenerationStatus.COMPLETED,
          progress: 100,
          outputMediaAssetId: videoAsset.id,
          durationSeconds: 2,
          isSelected: true,
          completedAt: new Date(),
        },
      });

      const sceneNarration = await prisma.sceneNarration.create({
        data: {
          narrationScriptId: script.id,
          storyId: story.id,
          sceneId: scene.id,
          sequence: scene.sceneNumber,
          text: scene.narration || `Narration for scene ${scene.sceneNumber}.`,
          emotionalTone: 'calm',
          speakingStyle: 'warm narrator',
          estimatedDuration: 1.5,
          status: SceneNarrationStatus.APPROVED,
        },
      });

      await prisma.audioGeneration.create({
        data: {
          userId: user.id,
          storyId: story.id,
          sceneId: scene.id,
          narrationScriptId: script.id,
          sceneNarrationId: sceneNarration.id,
          status: AudioGenerationStatus.COMPLETED,
          progress: 100,
          sourceText: sceneNarration.text,
          audioMediaAssetId: audioAsset.id,
          duration: 1.5,
          format: 'wav',
          sampleRate: 24000,
          channels: 1,
          isSelected: true,
          completedAt: new Date(),
        },
      });
    }

    return { sceneCount, userId: user.id };
  }

  async function waitForRender(
    renderId: string,
    token = accessTokenA,
    timeoutMs = 180_000,
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/renders/${renderId}/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const status = res.body.data.status as string;
      if (status === 'COMPLETED') return res.body.data;
      if (status === 'FAILED' || status === 'CANCELLED') {
        throw new Error(`Render ended with ${status}: ${res.body.data.errorMessage}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Timed out waiting for render ${renderId}`);
  }

  async function probeDownloadedMp4(url: string) {
    const dir = await mkdtemp(join(tmpdir(), 'render-probe-'));
    const filePath = join(dir, 'out.mp4');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    const probeJson = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'ffprobe',
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `ffprobe exit ${code}`));
      });
    });

    return {
      filePath,
      fileSize: buffer.length,
      probe: JSON.parse(probeJson) as {
        format?: { duration?: string; size?: string };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
        }>;
      },
    };
  }

  it('returns readiness checklist and blocks incomplete stories', async () => {
    const story = await createReadyStory();
    const readiness = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/renders/readiness`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(readiness.body.data.canRender).toBe(false);
    expect(readiness.body.data.missing.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/renders`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({})
      .expect(400);
  }, 90_000);

  it('enforces render ownership isolation', async () => {
    const story = await createReadyStory();
    await seedPhaseAssets(story);

    const created = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/renders`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        profileId: 'vertical-9x16-1080p30',
        subtitleEnabled: true,
        subtitleBurnedIn: false,
        qualityPreset: 'ultrafast',
      })
      .expect(201);

    const renderId = created.body.data.id as string;

    await request(app.getHttpServer())
      .get(`/api/renders/${renderId}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/renders/${renderId}/cancel`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);
  }, 120_000);

  it('renders a multi-scene MP4 from Phase 5/6/7 style assets', async () => {
    const story = await createReadyStory();
    expect(story.scenes.length).toBeGreaterThanOrEqual(2);
    const seeded = await seedPhaseAssets(story);

    const readiness = await request(app.getHttpServer())
      .get(`/api/stories/${story.id}/renders/readiness`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(readiness.body.data.canRender).toBe(true);
    expect(readiness.body.data.readyScenes).toBe(seeded.sceneCount);

    const created = await request(app.getHttpServer())
      .post(`/api/stories/${story.id}/renders`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({
        profileId: 'vertical-9x16-1080p30',
        subtitleEnabled: true,
        subtitleBurnedIn: true,
        qualityPreset: 'ultrafast',
        scenePaddingSeconds: 0.1,
        audioMix: { sceneGapSeconds: 0.05, duckingEnabled: false },
      })
      .expect(201);

    const renderId = created.body.data.id as string;
    expect(created.body.data.status).toBe('PENDING');

    const progress = await waitForRender(renderId);
    expect(progress.status).toBe('COMPLETED');
    expect(progress.progress).toBe(100);

    const detail = await request(app.getHttpServer())
      .get(`/api/renders/${renderId}`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(detail.body.data.status).toBe('COMPLETED');
    expect(detail.body.data.previewUrl).toMatch(/^https?:\/\//);
    expect(detail.body.data.width).toBe(1080);
    expect(detail.body.data.height).toBe(1920);
    expect(detail.body.data.totalSceneCount).toBe(2);
    expect(detail.body.data.duration).toBeGreaterThan(2.5);

    const download = await request(app.getHttpServer())
      .get(`/api/renders/${renderId}/download`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(download.body.data.downloadUrl).toMatch(/^https?:\/\//);

    const probed = await probeDownloadedMp4(download.body.data.downloadUrl);
    const video = probed.probe.streams?.find((s) => s.codec_type === 'video');
    const audio = probed.probe.streams?.find((s) => s.codec_type === 'audio');
    expect(video?.codec_name).toBe('h264');
    expect(video?.width).toBe(1080);
    expect(video?.height).toBe(1920);
    expect(audio?.codec_name).toBe('aac');
    expect(Number.parseFloat(probed.probe.format?.duration ?? '0')).toBeGreaterThan(2);
    expect(probed.fileSize).toBeGreaterThan(10_000);

    const subs = await request(app.getHttpServer())
      .get(`/api/renders/${renderId}/subtitles`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(subs.body.data.downloadUrl).toMatch(/^https?:\/\//);

    // Persist a sample probe summary for the completion report
    const samplePath = join(tmpdir(), 'phase8-sample-render.json');
    await writeFile(
      samplePath,
      JSON.stringify(
        {
          renderId,
          duration: probed.probe.format?.duration,
          width: video?.width,
          height: video?.height,
          videoCodec: video?.codec_name,
          audioCodec: audio?.codec_name,
          fileSize: probed.fileSize,
          samplePath,
        },
        null,
        2,
      ),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log('PHASE8_SAMPLE_RENDER', samplePath);
  }, 300_000);
});
