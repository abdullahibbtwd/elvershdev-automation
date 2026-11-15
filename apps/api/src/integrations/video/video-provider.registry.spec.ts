import { VideoProviderRegistry } from './video-provider.registry';

describe('VideoProviderRegistry', () => {
  const previousProvider = process.env.VIDEO_GENERATION_PROVIDER;
  const previousKlingEnabled = process.env.KLING_ENABLED;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.VIDEO_GENERATION_PROVIDER;
    else process.env.VIDEO_GENERATION_PROVIDER = previousProvider;
    if (previousKlingEnabled === undefined) delete process.env.KLING_ENABLED;
    else process.env.KLING_ENABLED = previousKlingEnabled;
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

    return new VideoProviderRegistry(config as never, hailuo as never, kling as never);
  }

  it('defaults to hailuo and lists Kling as disabled', () => {
    process.env.VIDEO_GENERATION_PROVIDER = 'hailuo';
    process.env.KLING_ENABLED = 'false';
    const registry = createRegistry();
    expect(registry.getDefaultProviderId()).toBe('hailuo');
    const list = registry.listAvailability();
    const hailuo = list.find((p) => p.id === 'hailuo');
    const kling = list.find((p) => p.id === 'kling');
    expect(hailuo?.default).toBe(true);
    expect(hailuo?.enabled).toBe(true);
    expect(kling?.enabled).toBe(false);
    expect(kling?.unavailableReason).toMatch(/disabled/i);
  });

  it('blocks selecting Kling while disabled', () => {
    process.env.KLING_ENABLED = 'false';
    const registry = createRegistry();
    expect(() => registry.assertSelectable('kling')).toThrow(/disabled/i);
  });

  it('estimates hailuo default clip near $0.27', () => {
    const registry = createRegistry();
    expect(registry.estimateCost('hailuo', 6, '768P')).toBeCloseTo(0.27, 5);
  });
});
