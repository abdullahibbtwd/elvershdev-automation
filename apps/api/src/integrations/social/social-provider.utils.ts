import { createReadStream, promises as fs } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import type { AxiosError } from 'axios';

export function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

/**
 * Mock when SOCIAL_USE_MOCK, platform USE_MOCK, global USE_MOCK, or credentials missing.
 */
export function resolveSocialShouldUseMock(params: {
  config: ConfigService;
  platformUseMockKey: string;
  isConfigured: boolean;
}): boolean {
  const { config, platformUseMockKey, isConfigured } = params;
  return (
    isTruthyFlag(config.get('integrations.socialUseMock')) ||
    isTruthyFlag(config.get(platformUseMockKey)) ||
    isTruthyFlag(process.env.SOCIAL_USE_MOCK) ||
    isTruthyFlag(process.env.USE_MOCK) ||
    !isConfigured
  );
}

export function buildCaption(parts: {
  caption?: string;
  description?: string;
  title?: string;
  hashtags?: string[];
}): string {
  const base = (parts.caption ?? parts.description ?? parts.title ?? '').trim();
  const tags = (parts.hashtags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  if (!tags.length) return base;
  const tagLine = tags.join(' ');
  return base ? `${base}\n\n${tagLine}` : tagLine;
}

export async function getLocalFileSize(localFilePath: string, hinted?: number): Promise<number> {
  if (typeof hinted === 'number' && hinted > 0) return hinted;
  const stat = await fs.stat(localFilePath);
  return stat.size;
}

/** Read a file in fixed-size chunks without loading the entire file into memory. */
export async function* readFileChunks(
  localFilePath: string,
  chunkSize: number,
): AsyncGenerator<Buffer> {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be positive');
  }
  const stream = createReadStream(localFilePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

export function expiresAtFromSeconds(expiresIn?: number | string | null): Date | null {
  const seconds = typeof expiresIn === 'string' ? Number.parseInt(expiresIn, 10) : expiresIn;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

export function axiosErrorMessage(err: unknown, fallback = 'Request failed'): string {
  const ax = err as AxiosError<{ error?: { message?: string; code?: number | string }; message?: string }>;
  const data = ax?.response?.data;
  if (data && typeof data === 'object') {
    if (typeof data.error?.message === 'string') return data.error.message;
    if (typeof data.message === 'string') return data.message;
  }
  if (ax?.message) return ax.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** TikTok FILE_UPLOAD chunk plan per media transfer guide. */
export function planTikTokChunks(videoSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  const MIN = 5 * 1024 * 1024;
  const MAX = 64 * 1024 * 1024;
  if (videoSize <= 0) {
    throw new Error('videoSize must be positive');
  }
  if (videoSize < MIN) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  const chunkSize = Math.min(MAX, 10 * 1024 * 1024);
  const totalChunkCount = Math.max(1, Math.floor(videoSize / chunkSize));
  return { chunkSize, totalChunkCount };
}

export function mockId(prefix: string, seed?: string): string {
  const suffix = (seed ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'default';
  return `${prefix}-${suffix}`;
}
