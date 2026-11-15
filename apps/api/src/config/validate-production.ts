/**
 * Fail fast on insecure production configuration.
 * Called from main.ts before the Nest app starts listening.
 */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.NODE_ENV ?? 'development') !== 'production') {
    return;
  }

  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'CREDENTIALS_ENCRYPTION_KEY',
    'REDIS_HOST',
    'REDIS_PASSWORD',
    'MINIO_ENDPOINT',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'CORS_ORIGIN',
    'PUBLIC_API_URL',
  ] as const;

  const missing = required.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length) {
    throw new Error(`Production env missing required variables: ${missing.join(', ')}`);
  }

  const insecure: string[] = [];
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CREDENTIALS_ENCRYPTION_KEY'] as const) {
    const value = env[key] ?? '';
    if (value.length < 32) insecure.push(`${key} (min 32 chars)`);
    if (/change-me|changeme|secret|password|example/i.test(value)) {
      insecure.push(`${key} (placeholder value)`);
    }
  }
  if (env.MINIO_ACCESS_KEY === 'minioadmin' || env.MINIO_SECRET_KEY === 'minioadmin') {
    insecure.push('MINIO credentials still using minioadmin defaults');
  }
  if (env.POSTGRES_PASSWORD === 'aivideo') {
    insecure.push('POSTGRES_PASSWORD still using default aivideo');
  }
  if (!env.REDIS_PASSWORD) {
    insecure.push('REDIS_PASSWORD required in production');
  }

  if (insecure.length) {
    throw new Error(`Insecure production configuration: ${insecure.join('; ')}`);
  }
}
