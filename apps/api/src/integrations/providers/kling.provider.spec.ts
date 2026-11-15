import { ConfigService } from '@nestjs/config';
import { KlingProvider } from './kling.provider';

describe('KlingProvider', () => {
  const previousMock = process.env.KLING_USE_MOCK;
  const previousKey = process.env.KLING_API_KEY;

  afterEach(() => {
    if (previousMock === undefined) delete process.env.KLING_USE_MOCK;
    else process.env.KLING_USE_MOCK = previousMock;
    if (previousKey === undefined) delete process.env.KLING_API_KEY;
    else process.env.KLING_API_KEY = previousKey;
  });

  function createProvider(overrides: Record<string, string | number | undefined> = {}) {
    const values: Record<string, string | number | undefined> = {
      'integrations.klingApiKey': undefined,
      'integrations.klingUseMock': 'true',
      'integrations.klingModel': 'kling-2.6',
      'integrations.klingApiBaseUrl': 'https://api-singapore.klingai.com',
      'integrations.klingPricePerSecondUsd': '0.07',
      'integrations.klingCurrency': 'USD',
      'integrations.klingMockReadyAfterMs': 10,
      'integrations.klingTimeoutMs': 120000,
      ...overrides,
    };
    const config = {
      get: <T = string>(key: string, defaultValue?: T) =>
        (values[key] as T | undefined) ?? defaultValue,
    } as ConfigService;
    return new KlingProvider(config);
  }

  it('uses mock mode without API key', async () => {
    process.env.KLING_USE_MOCK = 'true';
    const provider = createProvider();
    expect(provider.shouldUseMock()).toBe(true);

    const submitted = await provider.submitImageToVideo({
      imageUrl: 'https://example.com/frame.png',
      motionPrompt: 'Slow cinematic push-in',
      durationSeconds: 5,
      resolution: '720p',
    });

    expect(submitted.providerTaskId).toMatch(/^mock-kling-/);
    expect(submitted.mock).toBe(true);
    expect(submitted.estimatedCostUsd).toBeGreaterThan(0);

    const status = await provider.getTaskStatus(submitted.providerTaskId);
    expect(['submitted', 'processing', 'succeeded']).toContain(status.status);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const ready = await provider.getTaskStatus(submitted.providerTaskId);
    expect(ready.status).toBe('succeeded');
    expect(ready.outputs[0]?.url).toMatch(/^mock:\/\//);

    const video = await provider.retrieveCompletedVideo(ready);
    expect(video.mimeType).toBe('video/mp4');
    expect(video.buffer.length).toBeGreaterThan(100);
  });

  it('reports cancel as unsupported', async () => {
    const provider = createProvider();
    await expect(provider.cancelTask('mock-kling-1')).resolves.toBe(false);
  });

  it('estimates cost from duration and resolution', () => {
    const provider = createProvider({
      'integrations.klingPricePerSecondUsd': '0.1',
    });
    expect(provider.estimateCost(5, '720p')).toBeCloseTo(0.5, 5);
  });
});
