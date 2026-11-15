import { validateProductionConfig } from './validate-production';

describe('validateProductionConfig', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CREDENTIALS_ENCRYPTION_KEY: 'c'.repeat(32),
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: 'strong-redis-password',
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_ACCESS_KEY: 'prodaccesskey',
    MINIO_SECRET_KEY: 'prodsecretkeyvalue',
    CORS_ORIGIN: 'https://example.com',
    PUBLIC_API_URL: 'https://example.com',
  };

  it('allows non-production without checks', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('passes with strong production secrets', () => {
    expect(() => validateProductionConfig(base)).not.toThrow();
  });

  it('rejects missing required variables', () => {
    expect(() =>
      validateProductionConfig({ NODE_ENV: 'production', DATABASE_URL: 'x' }),
    ).toThrow(/missing required/i);
  });

  it('rejects placeholder JWT secrets', () => {
    expect(() =>
      validateProductionConfig({
        ...base,
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars!!',
      }),
    ).toThrow(/insecure/i);
  });

  it('allows secrets that merely contain the word secret', () => {
    expect(() =>
      validateProductionConfig({
        ...base,
        JWT_ACCESS_SECRET: 'my_super_secret_key_with_32_chars_ok',
      }),
    ).not.toThrow();
  });

  it('rejects minioadmin defaults', () => {
    expect(() =>
      validateProductionConfig({
        ...base,
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin',
      }),
    ).toThrow(/minioadmin/i);
  });
});
