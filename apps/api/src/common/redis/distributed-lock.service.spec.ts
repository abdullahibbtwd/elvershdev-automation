import { ConfigService } from '@nestjs/config';
import { DistributedLockService } from './distributed-lock.service';

const store = new Map<string, { value: string; expiresAt: number }>();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    status: 'ready',
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
    set: jest.fn(async (key: string, value: string, _ex: string, ttl: number, nx: string) => {
      if (nx !== 'NX') return null;
      const existing = store.get(key);
      if (existing && existing.expiresAt > Date.now()) return null;
      store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
      return 'OK';
    }),
    eval: jest.fn(async (_script: string, _n: number, key: string, token: string) => {
      const existing = store.get(key);
      if (existing?.value === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  }));
});

describe('DistributedLockService', () => {
  beforeEach(() => {
    store.clear();
  });

  function createService() {
    const config = {
      get: (key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          'redis.host': 'localhost',
          'redis.port': 6379,
          'redis.password': undefined,
        };
        return map[key] ?? fallback;
      },
    } as ConfigService;
    return new DistributedLockService(config);
  }

  it('acquires only one lock for the same key', async () => {
    const a = createService();
    const b = createService();
    await expect(a.tryAcquire('cron:test', 30)).resolves.toBe(true);
    await expect(b.tryAcquire('cron:test', 30)).resolves.toBe(false);
    await a.release('cron:test');
    await expect(b.tryAcquire('cron:test', 30)).resolves.toBe(true);
  });

  it('withLock runs callback only when acquired', async () => {
    const a = createService();
    const first = await a.withLock('cron:x', 30, async () => 42);
    expect(first).toEqual({ acquired: true, result: 42 });

    await a.tryAcquire('cron:x', 30);
    const second = await a.withLock('cron:x', 30, async () => 99);
    expect(second).toEqual({ acquired: false });
  });
});
