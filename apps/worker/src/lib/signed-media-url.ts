import { createHmac } from 'node:crypto';

function hmac(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}:${exp}`).digest('hex');
}

/** Build a publicly fetchable media URL served by the API (Coolify-safe; no MinIO exposure). */
export function buildSignedMediaContentUrl(options: {
  publicApiUrl: string;
  storageKey: string;
  secret: string;
  expiresInSeconds?: number;
  apiPrefix?: string;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600);
  const sig = hmac(options.secret, options.storageKey, exp);
  const base = options.publicApiUrl.replace(/\/$/, '');
  const prefix = (options.apiPrefix ?? 'api').replace(/^\/|\/$/g, '');
  const url = new URL(`${base}/${prefix}/media/content`);
  url.searchParams.set('key', options.storageKey);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.toString();
}
