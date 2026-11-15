import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function verifySignedMediaContent(options: {
  storageKey: string;
  exp: number | string;
  sig: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const exp = typeof options.exp === 'string' ? Number.parseInt(options.exp, 10) : options.exp;
  if (!Number.isFinite(exp) || !options.storageKey || !options.sig) return false;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (exp < now) return false;
  if (options.storageKey.includes('..') || options.storageKey.startsWith('/')) return false;

  const expected = hmac(options.secret, options.storageKey, exp);
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(options.sig, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
