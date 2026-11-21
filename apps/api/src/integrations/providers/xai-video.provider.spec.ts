import type { ConfigService } from '@nestjs/config';
import { XaiVideoProvider } from './xai-video.provider';

describe('XaiVideoProvider', () => {
  const previousMock = process.env.XAI_VIDEO_USE_MOCK;
  const previousKey = process.env.XAI_API_KEY;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (previousMock === undefined) delete process.env.XAI_VIDEO_USE_MOCK;
    else process.env.XAI_VIDEO_USE_MOCK = previousMock;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  function createProvider(overrides: Record<string, unknown> = {}) {
    const map: Record<string, unknown> = {
      'integrations.xaiVideoModel': 'grok-imagine-video-1.5-lite',
      'integrations.xaiVideoUseMock': 'true',
      'integrations.xaiVideoMockReadyAfterMs': 10,
      'integrations.xaiVideoCurrency': 'USD',
      'integrations.xaiVideoPricePerSecond480PUsd': '0.02',
      'integrations.xaiVideoPricePerSecond720PUsd': '0.03',
      'integrations.xaiVideoPricePerSecond1080PUsd': '0.14',
      'integrations.xaiVideoTimeoutMs': 120000,
      'integrations.xaiVideoApiBaseUrl': 'https://api.x.ai/v1',
      ...overrides,
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => map[key] ?? fallback),
    } as unknown as ConfigService;
    return new XaiVideoProvider(config);
  }

  it('rejects non-Lite models', () => {
    expect(() =>
      createProvider({ 'integrations.xaiVideoModel': 'grok-imagine-video-1.5' }).getModel(),
    ).toThrow(/Only grok-imagine-video-1.5-lite/);
  });

  it('estimates 720p cost at $0.03/sec', () => {
    const provider = createProvider();
    expect(provider.estimateCost(10, '720p')).toBeCloseTo(0.3, 5);
  });

  it('submits text-to-video in mock mode and polls to completion', async () => {
    process.env.NODE_ENV = 'development';
    process.env.XAI_VIDEO_USE_MOCK = 'true';
    delete process.env.XAI_API_KEY;
    const provider = createProvider();

    const submit = await provider.submitTextToVideo({
      prompt: 'A cinematic two-shot conversation on a balcony at dusk',
      durationSeconds: 6,
      resolution: '720p',
    });
    expect(submit.mock).toBe(true);
    expect(submit.providerTaskId).toMatch(/^mock-xai-/);
    expect(submit.model).toContain('grok-imagine-video-1.5-lite');

    await new Promise((r) => setTimeout(r, 20));
    const status = await provider.getTaskStatus(submit.providerTaskId);
    expect(status.status).toBe('succeeded');
    expect(status.outputs[0]?.url).toMatch(/^mock:\/\/xai\//);

    const video = await provider.retrieveCompletedVideo(status);
    expect(video.mimeType).toBe('video/mp4');
    expect(video.contentLength).toBeGreaterThan(0);
  });

  it('submits image-to-video in mock mode', async () => {
    const provider = createProvider();
    const submit = await provider.submitImageToVideo({
      imageUrl: 'https://example.com/frame.png',
      motionPrompt: 'Camera slowly pushes in while the actor speaks',
      durationSeconds: 5,
      resolution: '720p',
    });
    expect(submit.mock).toBe(true);
    expect(submit.estimatedCostUsd).toBeCloseTo(0.15, 5);
  });
});
