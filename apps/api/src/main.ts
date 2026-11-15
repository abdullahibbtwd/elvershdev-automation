import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { getProcessRole, shouldServeHttp } from './common/process-role';
import { validateProductionConfig } from './config/validate-production';

async function bootstrap() {
  validateProductionConfig();

  const processRole = getProcessRole();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);

  if (process.env.TRUST_PROXY === 'true' || config.get('nodeEnv') === 'production') {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    expressApp.set('trust proxy', 1);
  }

  app.use(helmet({
    contentSecurityPolicy: config.get('nodeEnv') === 'production' ? undefined : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  app.use(cookieParser());

  // Request correlation id for API ↔ worker log linkage
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      (typeof incoming === 'string' && incoming) ||
      (Array.isArray(incoming) && incoming[0]) ||
      randomUUID();
    req.id = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  const corsOrigin = config.get<string>('corsOrigin', 'http://localhost:5173');
  app.enableCors({
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  app.setGlobalPrefix(config.get<string>('apiPrefix', 'api'));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.SWAGGER_ENABLED !== 'false' && config.get('nodeEnv') !== 'production');
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI Video Platform API')
      .setDescription('Production API for AI video automation')
      .setVersion(process.env.APP_VERSION ?? '0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get<number>('port', 3000);
  if (shouldServeHttp(processRole)) {
    await app.listen(port);
    logger.log(
      {
        port,
        processRole,
        env: config.get('nodeEnv'),
        rollout: config.get('ops.rolloutStage'),
        swagger: swaggerEnabled,
      },
      `API listening on port ${port}`,
    );
  } else {
    // Scheduler-only role: Nest module init still registers crons + queue hosts.
    await app.init();
    logger.log(
      {
        processRole,
        env: config.get('nodeEnv'),
        rollout: config.get('ops.rolloutStage'),
      },
      'Scheduler process started (HTTP disabled)',
    );
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to bootstrap API', error);
  process.exit(1);
});
