import { VideoProviderRegistry } from './video-provider.registry';

describe('VideoProviderRegistry', () => {
  const previousProvider = process.env.VIDEO_GENERATION_PROVIDER;
  const previousKlingEnabled = process.env.KLING_ENABLED;
  const previousXaiEnabled = process.env.XAI_VIDEO_ENABLED;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.VIDEO_GENERATION_PROVIDER;
    else process.env.VIDEO_GENERATION_PROVIDER = previousProvider;
    if (previousKlingEnabled === undefined) delete process.env.KLING_ENABLED;
    else process.env.KLING_ENABLED = previousKlingEnabled;
    if (previousXaiEnabled === undefined) delete process.env.XAI_VIDEO_ENABLED;
    else process.env.XAI_VIDEO_ENABLED = previousXaiEnabled;
  });

  function createRegistry() {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          'integrations.hailuoDefaultDuration': 6,
          'integrations.hailuoDefaultResolution': '768P',
          'integrations.hailuoCurrency': 'USD',
          'integrations.hailuoPricePerSecond768PUsd': '0.045',
          'integrations.hailuoPricePerSecond512PUsd': '0.017',
          'integrations.klingDefaultDurationSeconds': 5,
          'integrations.klingDefaultResolution': '720p',
          'integrations.klingCurrency': 'USD',
          'integrations.klingPricePerSecondUsd': '0.07',
          'integrations.xaiVideoDefaultDuration': 8,
          'integrations.xaiVideoResolution': '720p',
          'integrations.xaiVideoCurrency': 'USD',
          'integrations.xaiVideoPricePerSecond480PUsd': '0.02',
          'integrations.xaiVideoPricePerSecond720PUsd': '0.03',
          'integrations.xaiVideoPricePerSecond1080PUsd': '0.14',
        };
        return map[key] ?? fallback;
      }),
    };

    const hailuo = {
      name: 'hailuo',
      isConfigured: () => false,
      shouldUseMock: () => true,
      getModel: () => 'fal-ai/minimax/hailuo-02/standard/image-to-video',
    };
    const kling = {
      name: 'kling',
      isConfigured: () => false,
      shouldUseMock: () => true,
      getModel: () => 'kling-2.6',
    };
    const xai = {
      name: 'xai',
      isConfigured: () => false,
      shouldUseMock: () => true,
      getModel: () => 'grok-imagine-video-1.5-lite',
    };

    return new VideoProviderRegistry(
      config as never,
      hailuo as never,
      kling as never,
      xai as never,
    );
  }

  it('defaults to hailuo and lists Kling/xAI as disabled', () => {
    process.env.VIDEO_GENERATION_PROVIDER = 'hailuo';
    process.env.KLING_ENABLED = 'false';
    process.env.XAI_VIDEO_ENABLED = 'false';
    const registry = createRegistry();
    expect(registry.getDefaultProviderId()).toBe('hailuo');
    const list = registry.listAvailability();
    const hailuo = list.find((p) => p.id === 'hailuo');
    const kling = list.find((p) => p.id === 'kling');
    const xai = list.find((p) => p.id === 'xai');
    expect(hailuo?.default).toBe(true);
    expect(hailuo?.enabled).toBe(true);
    expect(kling?.enabled).toBe(false);
    expect(kling?.unavailableReason).toMatch(/disabled/i);
    expect(xai?.enabled).toBe(false);
    expect(xai?.model).toBe('grok-imagine-video-1.5-lite');
    expect(xai?.unavailableReason).toMatch(/disabled/i);
  });

  it('blocks selecting Kling or xAI while disabled', () => {
    process.env.KLING_ENABLED = 'false';
    process.env.XAI_VIDEO_ENABLED = 'false';
    const registry = createRegistry();
    expect(() => registry.assertSelectable('kling')).toThrow(/disabled/i);
    expect(() => registry.assertSelectable('xai')).toThrow(/disabled/i);
  });

  it('estimates hailuo default clip near $0.27 and xAI 8s 720p at $0.24', () => {
    const registry = createRegistry();
    expect(registry.estimateCost('hailuo', 6, '768P')).toBeCloseTo(0.27, 5);
    expect(registry.estimateCost('xai', 8, '720p')).toBeCloseTo(0.24, 5);
  });

  it('resolves xai when enabled', () => {
    process.env.XAI_VIDEO_ENABLED = 'true';
    const registry = createRegistry();
    expect(registry.resolve('xai').name).toBe('xai');
    expect(registry.getDefaultDuration('xai')).toBe(8);
    expect(registry.getDefaultResolution('xai')).toBe('720p');
  });
});
