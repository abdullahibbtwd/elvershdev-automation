import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import IORedis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly client: IORedis;

  constructor(config: ConfigService) {
    super();
    this.client = new IORedis({
      host: config.get<string>('redis.host', 'localhost'),
      port: config.get<number>('redis.port', 6379),
      password: config.get<string>('redis.password'),
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      if (this.client.status !== 'ready') {
        await this.client.connect();
      }
      const pong = await this.client.ping();
      return this.getStatus(key, pong === 'PONG');
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
