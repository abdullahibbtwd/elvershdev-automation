import pino from 'pino';

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'worker',
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? '0.1.0',
    },
    redact: {
      paths: [
        'password',
        'refreshToken',
        'accessToken',
        'token',
        'authorization',
        'apiKey',
        'secret',
        'CREDENTIALS_ENCRYPTION_KEY',
      ],
      remove: true,
    },
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
