import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'Str0ngPass1';
  const otherPassword = 'An0therPass1';

  beforeAll(async () => {
    const allowAll: CanActivate = { canActivate: () => true };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue(allowAll)
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
  });

  beforeEach(async () => {
    await prisma.characterVisualReference.deleteMany();
    await prisma.sceneVisual.deleteMany();
    await prisma.providerUsage.deleteMany();
    await prisma.storyGeneration.deleteMany();
    await prisma.storyScene.deleteMany();
    await prisma.characterProfile.deleteMany();
    await prisma.publishRecord.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.generationJob.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.videoProject.deleteMany();
    await prisma.story.deleteMany();
    await prisma.visualStyle.deleteMany({ where: { isSystem: false } });
    await prisma.socialChannel.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  function extractCookie(res: request.Response, name: string): string | undefined {
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const match = cookies.find((c) => c.startsWith(`${name}=`));
    if (!match) return undefined;
    return match.split(';')[0]?.split('=').slice(1).join('=');
  }

  it('registers a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('ada@example.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(extractCookie(res, 'refresh_token')).toBeDefined();
  });

  it('rejects duplicate email registration', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada 2', email: 'ada@example.com', password })
      .expect(409);

    expect(res.body.success).toBe(false);
  });

  it('logs in with valid credentials and rejects invalid ones', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    const ok = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password })
      .expect(200);

    expect(ok.body.data.accessToken).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-pass' })
      .expect(401);
  });

  it('validates access tokens on protected routes', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
      .expect(200);

    expect(me.body.data.email).toBe('ada@example.com');
    expect(me.body.data.passwordHash).toBeUndefined();
  });

  it('rotates refresh tokens and rejects revoked ones', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    const oldRefresh = extractCookie(registered, 'refresh_token');
    expect(oldRefresh).toBeDefined();

    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${oldRefresh}`)
      .expect(200);

    const newRefresh = extractCookie(refreshed, 'refresh_token');
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toEqual(oldRefresh);
    expect(refreshed.body.data.accessToken).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${oldRefresh}`)
      .expect(401);
  });

  it('logs out and rejects the previous refresh token', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    const refresh = extractCookie(registered, 'refresh_token');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${refresh}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refresh}`)
      .expect(401);
  });

  it('isolates user data between accounts', async () => {
    const userA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'User A', email: 'a@example.com', password })
      .expect(201);

    const userB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'User B', email: 'b@example.com', password: otherPassword })
      .expect(201);

    const meA = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${userA.body.data.accessToken}`)
      .expect(200);

    const meB = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${userB.body.data.accessToken}`)
      .expect(200);

    expect(meA.body.data.email).toBe('a@example.com');
    expect(meB.body.data.email).toBe('b@example.com');
    expect(meA.body.data.id).not.toEqual(meB.body.data.id);
  });

  it('protects feature routes', async () => {
    await request(app.getHttpServer()).get('/api/stories').expect(401);
    await request(app.getHttpServer()).get('/api/users/me').expect(401);

    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/stories')
      .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
      .expect(200);
  });



  it('supports logout-all and change-password', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password })
      .expect(201);

    const refresh = extractCookie(registered, 'refresh_token');
    const access = registered.body.data.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refresh}`)
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ currentPassword: password, newPassword: 'N3wPassword!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'N3wPassword!' })
      .expect(200);
  });
});
