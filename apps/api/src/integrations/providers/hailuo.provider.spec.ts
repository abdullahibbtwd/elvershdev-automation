import { ConfigService } from '@nestjs/config';
import { HailuoProvider } from './hailuo.provider';

describe('HailuoProvider', () => {
  const previousMock = process.env.HAILUO_USE_MOCK;
  const previousKey = process.env.FAL_API_KEY;

  beforeEach(() => {
    process.env.HAILUO_USE_MOCK = 'true';
    delete process.env.FAL_API_KEY;
  });

  afterAll(() => {
    if (previousMock === undefined) delete process.env.HAILUO_USE_MOCK;
    else process.env.HAILUO_USE_MOCK = previousMock;
    if (previousKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = previousKey;
  });

  function createProvider() {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          'integrations.hailuoUseMock': 'true',
          'integrations.hailuoModel':
            'fal-ai/minimax/hailuo-02/standard/image-to-video',
          'integrations.hailuoDefaultDuration': 6,
          'integrations.hailuoDefaultResolution': '768P',
          'integrations.hailuoPromptOptimizer': 'true',
          'integrations.hailuoCurrency': 'USD',
          'integrations.hailuoPricePerSecond768PUsd': '0.045',
          'integrations.hailuoPricePerSecond512PUsd': '0.017',
          'integrations.hailuoMockReadyAfterMs': 10,
          'integrations.hailuoTimeoutMs': 600000,
        };
        return map[key] ?? fallback;
      }),
    };
    return new HailuoProvider(config as unknown as ConfigService);
  }

  it('submits mock image-to-video and returns a request id', async () => {
    const provider = createProvider();
    const submitted = await provider.submitImageToVideo({
      imageUrl: 'https://example.com/source.png',
      motionPrompt: 'Slow cinematic push-in on the craftsman',
      durationSeconds: 6,
      resolution: '768P',
    });

    expect(submitted.providerTaskId).toMatch(/^mock-hailuo-/);
    expect(submitted.mock).toBe(true);
    expect(submitted.estimatedCostUsd).toBeCloseTo(0.27, 5);
    expect(submitted.model).toContain('hailuo-02');
  });

  it('polls mock status through to success and retrieves an MP4', async () => {
    const provider = createProvider();
    const submitted = await provider.submitImageToVideo({
      imageUrl: 'https://example.com/source.png',
      motionPrompt: 'Gentle head turn',
      durationSeconds: 6,
      resolution: '768P',
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    const status = await provider.getTaskStatus(submitted.providerTaskId);
    expect(status.status).toBe('succeeded');
    expect(status.outputs[0]?.url).toMatch(/^mock:\/\/hailuo\//);

    const video = await provider.retrieveCompletedVideo(status);
    expect(video.mimeType).toBe('video/mp4');
    expect(video.contentLength).toBeGreaterThan(100);
    expect(Buffer.from(video.buffer).includes(Buffer.from('ftyp'))).toBe(true);
  });

  it('estimates 512P cheaper than 768P', () => {
    const provider = createProvider();
    const cost768 = provider.estimateCost(6, '768P');
    const cost512 = provider.estimateCost(6, '512P');
    expect(cost768).toBeCloseTo(0.27, 5);
    expect(cost512).toBeCloseTo(0.102, 5);
    expect(cost512).toBeLessThan(cost768);
  });

  it('reports cancel as unsupported', async () => {
    const provider = createProvider();
    await expect(provider.cancelTask('mock-hailuo-x')).resolves.toBe(false);
  });

  it('rejects invalid duration before submit', async () => {
    const provider = createProvider();
    await expect(
      provider.submitImageToVideo({
        imageUrl: 'https://example.com/source.png',
        motionPrompt: 'Motion',
        durationSeconds: 5,
        resolution: '768P',
      }),
    ).rejects.toThrow(/duration/i);
  });
});
