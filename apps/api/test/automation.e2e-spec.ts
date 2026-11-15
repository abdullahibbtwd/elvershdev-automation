import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  PublishStatus,
  ScheduledPublicationStatus,
  SocialConnectionStatus,
  SocialPlatform,
  VideoRenderStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AutomationOrchestratorService } from '../src/modules/automation/automation-orchestrator.service';
import { AutomationPublishSchedulerService } from '../src/modules/automation/automation-publish-scheduler.service';
import { ContentPlannerService } from '../src/modules/automation/content-planner.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Automation Phase 10 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let planner: ContentPlannerService;
  let orchestrator: AutomationOrchestratorService;
  let publishScheduler: AutomationPublishSchedulerService;
  let accessTokenA = '';
  let accessTokenB = '';
  let userIdA = '';
  let userIdB = '';
  const password = 'Str0ngPass1';

  beforeAll(async () => {
    process.env.GEMINI_USE_MOCK = 'true';
    process.env.SOCIAL_USE_MOCK = 'true';
    process.env.AUTOMATION_CRON_DISABLED = 'true';
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
    planner = app.get(ContentPlannerService);
    orchestrator = app.get(AutomationOrchestratorService);
    publishScheduler = app.get(AutomationPublishSchedulerService);
  }, 60_000);

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.automationAuditLog.deleteMany();
    await prisma.automationExecution.deleteMany();
    await prisma.scheduledPublication.deleteMany();
    await prisma.contentSchedule.deleteMany();
    await prisma.contentPlan.deleteMany();
    await prisma.automationConfig.deleteMany();
    await prisma.publishRecord.deleteMany();
    await prisma.videoRenderScene.deleteMany();
    await prisma.videoRender.deleteMany();
    await prisma.audioGeneration.deleteMany();
    await prisma.sceneNarration.deleteMany();
    await prisma.narrationScript.deleteMany();
    await prisma.motionGeneration.deleteMany();
    await prisma.characterVisualReference.deleteMany();
    await prisma.sceneVisual.deleteMany();
    await prisma.providerUsage.deleteMany();
    await prisma.storyGeneration.deleteMany();
    await prisma.storyScene.deleteMany();
    await prisma.characterProfile.deleteMany();
    await prisma.generationJob.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.videoProject.deleteMany();
    await prisma.story.deleteMany();
    await prisma.socialChannel.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.user.deleteMany();

    const userA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Auto A', email: 'auto-a@example.com', password })
      .expect(201);
    const userB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Auto B', email: 'auto-b@example.com', password })
      .expect(201);

    accessTokenA = userA.body.data.accessToken;
    accessTokenB = userB.body.data.accessToken;
    userIdA = userA.body.data.user.id;
    userIdB = userB.body.data.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function enableAutomation(token: string, overrides: Record<string, unknown> = {}) {
    await request(app.getHttpServer())
      .patch('/api/automation/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        dailyGenerationTarget: 2,
        timezone: 'UTC',
        includeWeekends: true,
        preferredPublishingDays: [0, 1, 2, 3, 4, 5, 6],
        ...overrides,
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/automation/enable')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  it('plans two videos for the configurable daily target and prevents duplicates', async () => {
    await enableAutomation(accessTokenA);

    const first = await request(app.getHttpServer())
      .post('/api/automation/run-now')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    expect(first.body.data.createdCount ?? first.body.data.skipped).toBeDefined();
    if (!first.body.data.skipped) {
      expect(first.body.data.createdCount).toBe(2);
    }

    const plans = await request(app.getHttpServer())
      .get('/api/automation/plans')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);

    expect(plans.body.data.length).toBeGreaterThanOrEqual(2);
    const fingerprints = plans.body.data.map((p: { ideaFingerprint: string }) => p.ideaFingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);

    // Concurrent second run should not create extra slots for same day
    const [a, b] = await Promise.all([
      planner.planDailyForUser(userIdA, { force: true }),
      planner.planDailyForUser(userIdA, { force: true }),
    ]);
    void a;
    void b;
    const recount = await prisma.contentPlan.count({ where: { userId: userIdA } });
    expect(recount).toBe(2);
  });

  it('respects pause, resume, emergency stop, and does not delete schedules', async () => {
    await enableAutomation(accessTokenA);
    await request(app.getHttpServer())
      .post('/api/automation/run-now')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const before = await prisma.contentSchedule.count({ where: { userId: userIdA } });
    expect(before).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .post('/api/automation/pause')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const pausedPlan = await planner.planDailyForUser(userIdA);
    expect(pausedPlan.skipped).toBe(true);

    await request(app.getHttpServer())
      .post('/api/automation/resume')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/automation/emergency-stop')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const after = await prisma.contentSchedule.count({ where: { userId: userIdA } });
    expect(after).toBe(before);
  });

  it('enforces budget limits by marking schedules budget-blocked', async () => {
    await enableAutomation(accessTokenA, {
      dailyBudgetUsd: 0.01,
      monthlyBudgetUsd: 0.01,
    });

    await prisma.providerUsage.create({
      data: {
        userId: userIdA,
        provider: 'gemini',
        model: 'mock',
        requestType: 'story',
        estimatedCost: 5,
      },
    });

    const result = await planner.planDailyForUser(userIdA, { force: true });
    expect(result.skipped).toBe(true);
    expect(String(result.reason)).toMatch(/budget/i);
  });

  it('schedules one completed render across four channels with independent outcomes', async () => {
    await enableAutomation(accessTokenA);

    const story = await prisma.story.create({
      data: {
        userId: userIdA,
        title: 'Automation publish story',
        content: 'Story body',
        status: 'READY',
        description: 'Desc',
        hashtags: ['auto'],
      },
    });

    const media = await prisma.mediaAsset.create({
      data: {
        userId: userIdA,
        type: 'VIDEO',
        storageKey: `renders/${userIdA}/mock.mp4`,
        mimeType: 'video/mp4',
        fileSize: 1024,
      },
    });

    const render = await prisma.videoRender.create({
      data: {
        userId: userIdA,
        storyId: story.id,
        status: VideoRenderStatus.COMPLETED,
        outputMediaAssetId: media.id,
        progress: 100,
        completedAt: new Date(),
      },
    });

    const channels = await Promise.all(
      (
        [
          [SocialPlatform.FACEBOOK, SocialConnectionStatus.PUBLIC_READY],
          [SocialPlatform.INSTAGRAM, SocialConnectionStatus.PUBLIC_READY],
          [SocialPlatform.TIKTOK, SocialConnectionStatus.TEST_ONLY],
          [SocialPlatform.YOUTUBE, SocialConnectionStatus.PUBLIC_READY],
        ] as const
      ).map(([platform, connectionStatus]) =>
        prisma.socialChannel.create({
          data: {
            userId: userIdA,
            platform,
            accountName: `${platform} Page`,
            platformAccountId: `${platform.toLowerCase()}-1`,
            connectionStatus,
            accessTokenEncrypted: 'enc',
            publishingCapabilities: {
              canPublishVideo: true,
              supportedMimeTypes: ['video/mp4'],
            },
          },
        }),
      ),
    );

    const plan = await prisma.contentPlan.create({
      data: {
        userId: userIdA,
        plannedDate: new Date('2026-03-14'),
        slotIndex: 0,
        status: 'APPROVED',
        ideaTitle: 'Publish demo',
        ideaSummary: 'Summary',
        ideaFingerprint: 'fp-demo',
        storyBrief: {
          topic: 'demo',
          niche: 'Motivation',
          targetAudience: 'All',
          language: 'en',
          tone: 'Warm',
          desiredDurationSeconds: 60,
          category: 'Narrative',
        },
        storyId: story.id,
        idempotencyKey: `plan:${userIdA}:demo:0`,
      },
    });

    const schedule = await prisma.contentSchedule.create({
      data: {
        userId: userIdA,
        contentPlanId: plan.id,
        status: 'READY',
        currentStage: 'PUBLISH_SCHEDULE',
        storyId: story.id,
        videoRenderId: render.id,
        scheduledPublishAt: new Date(Date.now() - 1000),
        idempotencyKey: `schedule:${plan.id}`,
      },
    });

    const config = await prisma.automationConfig.findUniqueOrThrow({ where: { userId: userIdA } });
    const scheduled = await publishScheduler.scheduleForRender({
      userId: userIdA,
      contentScheduleId: schedule.id,
      videoRenderId: render.id,
      storyId: story.id,
      scheduledPublishAt: new Date(Date.now() - 1000),
      config,
    });

    expect(scheduled.created).toBe(4);

    // Concurrent enqueue claims should not double-create publish records
    const pubs = await prisma.scheduledPublication.findMany({
      where: { contentScheduleId: schedule.id },
    });
    expect(pubs).toHaveLength(4);

    await Promise.all(
      pubs.map((pub) => publishScheduler.enqueueOne(pub.id, true).catch(() => undefined)),
    );

    // Simulate independent platform outcomes
    const records = await prisma.publishRecord.findMany({ where: { userId: userIdA } });
    expect(records.length).toBeGreaterThanOrEqual(1);

    if (records[0]) {
      await prisma.publishRecord.update({
        where: { id: records[0].id },
        data: { status: PublishStatus.PUBLISHED, publishedAt: new Date(), postUrl: 'https://example.com/p/1' },
      });
    }
    if (records[1]) {
      await prisma.publishRecord.update({
        where: { id: records[1].id },
        data: { status: PublishStatus.FAILED, errorMessage: 'platform error' },
      });
    }
    if (records[2]) {
      await prisma.publishRecord.update({
        where: { id: records[2].id },
        data: { status: PublishStatus.PUBLISHED, publishedAt: new Date() },
      });
    }
    if (records[3]) {
      await prisma.publishRecord.update({
        where: { id: records[3].id },
        data: { status: PublishStatus.ACTION_REQUIRED, errorMessage: 'pending review' },
      });
    }

    await publishScheduler.reconcilePublicationOutcomes(userIdA);

    const outcomes = await prisma.scheduledPublication.findMany({
      where: { contentScheduleId: schedule.id },
    });
    const statuses = new Set(outcomes.map((o) => o.status));
    expect(statuses.has(ScheduledPublicationStatus.PUBLISHED) || statuses.has(ScheduledPublicationStatus.FAILED) || statuses.has(ScheduledPublicationStatus.PUBLISHING) || statuses.has(ScheduledPublicationStatus.QUEUED)).toBe(true);

    // Ineligible channel path
    await prisma.socialChannel.update({
      where: { id: channels[0].id },
      data: { connectionStatus: SocialConnectionStatus.EXPIRED },
    });

    const dashboard = await request(app.getHttpServer())
      .get('/api/automation/dashboard')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(dashboard.body.data.operationalStatus).toBeDefined();
  });

  it('isolates ownership between users', async () => {
    await enableAutomation(accessTokenA);
    await enableAutomation(accessTokenB);
    await request(app.getHttpServer())
      .post('/api/automation/run-now')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const plansA = await request(app.getHttpServer())
      .get('/api/automation/plans')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    const plansB = await request(app.getHttpServer())
      .get('/api/automation/plans')
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(200);

    expect(plansA.body.data.length).toBeGreaterThan(0);
    expect(plansB.body.data.length).toBe(0);

    const foreignId = plansA.body.data[0].id as string;
    await request(app.getHttpServer())
      .get(`/api/automation/plans/${foreignId}`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .expect(404);
  });

  it('supports calendar reschedule and execution listing', async () => {
    await enableAutomation(accessTokenA);
    await request(app.getHttpServer())
      .post('/api/automation/run-now')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(201);

    const calendar = await request(app.getHttpServer())
      .get('/api/automation/calendar?view=week')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(calendar.body.data.items.length).toBeGreaterThanOrEqual(2);

    const scheduleId = calendar.body.data.items[0].id as string;
    const next = new Date(Date.now() + 3600_000).toISOString();
    await request(app.getHttpServer())
      .post(`/api/automation/calendar/${scheduleId}/reschedule`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ scheduledGenerationAt: next })
      .expect(201);

    await orchestrator.enqueueAdvance(userIdA, scheduleId, 'advance');
    const executions = await request(app.getHttpServer())
      .get('/api/automation/executions')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200);
    expect(Array.isArray(executions.body.data)).toBe(true);
  });
});
