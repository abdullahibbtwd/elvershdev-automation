import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';

/**
 * Redis SET NX EX distributed lock. Safe across multiple API replicas.
 * Not an in-memory lock — required for automation/analytics cron leaders.
 */
@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: IORedis;
  private readonly tokenByKey = new Map<string, string>();

  constructor(private readonly config: ConfigService) {
    this.redis = new IORedis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async onModuleDestroy() {
    for (const key of [...this.tokenByKey.keys()]) {
      await this.release(key).catch(() => undefined);
    }
    await this.redis.quit().catch(() => undefined);
  }

  async tryAcquire(key: string, ttlSeconds: number): Promise<boolean> {
    const token = randomUUID();
    const fullKey = `lock:${key}`;
    try {
      if (this.redis.status !== 'ready') {
        await this.redis.connect();
      }
      const result = await this.redis.set(fullKey, token, 'EX', ttlSeconds, 'NX');
      if (result === 'OK') {
        this.tokenByKey.set(key, token);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn(`Lock acquire failed for ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async release(key: string): Promise<void> {
    const token = this.tokenByKey.get(key);
    if (!token) return;
    const fullKey = `lock:${key}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, fullKey, token);
    } finally {
      this.tokenByKey.delete(key);
    }
  }

  async withLock<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<{ acquired: boolean; result?: T }> {
    const acquired = await this.tryAcquire(key, ttlSeconds);
    if (!acquired) {
      return { acquired: false };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await this.release(key);
    }
  }
}
