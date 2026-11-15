import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { CryptoModule } from './common/crypto/crypto.module';
import { RedisLockModule } from './common/redis/redis-lock.module';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AiGenerationModule } from './modules/ai-generation/ai-generation.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AutomationModule } from './modules/automation/automation.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OpsModule } from './modules/ops/ops.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { RenderingModule } from './modules/rendering/rendering.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StoriesModule } from './modules/stories/stories.module';
import { UsersModule } from './modules/users/users.module';
import { VisualStylesModule } from './modules/visual-styles/visual-styles.module';
import { VisualsModule } from './modules/visuals/visuals.module';
import { MotionModule } from './modules/motion/motion.module';
import { NarrationModule } from './modules/narration/narration.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: true,
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'password',
          'refreshToken',
          'accessToken',
          'token',
          'secret',
          'apiKey',
        ],
        customProps: () => ({
          service: 'api',
          environment: process.env.NODE_ENV ?? 'development',
        }),
      },
    }),
    ThrottlerModule.forRoot({
      skipIf: () => process.env.NODE_ENV === 'test',
      throttlers: [
        {
          ttl: 60_000,
          limit: 100,
        },
      ],
    }),
    ScheduleModule.forRoot(),
    RedisLockModule,
    CryptoModule,
    PrismaModule,
    QueueModule,
    StorageModule,
    IntegrationsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    DashboardModule,
    StoriesModule,
    VisualStylesModule,
    VisualsModule,
    MotionModule,
    NarrationModule,
    ProjectsModule,
    AiGenerationModule,
    MediaModule,
    JobsModule,
    RenderingModule,
    PublishingModule,
    ChannelsModule,
    SchedulingModule,
    AutomationModule,
    AnalyticsModule,
    NotificationsModule,
    SettingsModule,
    OpsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
