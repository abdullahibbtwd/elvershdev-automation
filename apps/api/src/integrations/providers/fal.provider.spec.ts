import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { estimateFalImageCostUsd, getFalPricingFromEnv } from '@ai-video/shared';
import { FalProvider } from './fal.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FalProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetAllMocks();
  });

  function createProvider(env: Record<string, string | number | undefined> = {}) {
    const config = {
      get: (key: string, defaultValue?: unknown) => {
        const map: Record<string, unknown> = {
          'integrations.falApiKey': env.FAL_API_KEY,
          'integrations.falUseMock': env.FAL_USE_MOCK,
          'integrations.falImageModel': env.FAL_IMAGE_MODEL ?? 'fal-ai/flux/dev',
          'integrations.falPricePerImage': env.FAL_IMAGE_PRICE_PER_IMAGE ?? '0.025',
          'integrations.falCurrency': env.FAL_IMAGE_CURRENCY ?? 'USD',
          'integrations.falDefaultAspectRatio': env.FAL_IMAGE_DEFAULT_ASPECT_RATIO ?? '9:16',
          'integrations.falDefaultFormat': env.FAL_IMAGE_DEFAULT_FORMAT ?? 'png',
          'integrations.falTimeoutMs': env.FAL_IMAGE_TIMEOUT_MS ?? 120_000,
          'integrations.falMaxRetries': env.FAL_IMAGE_MAX_RETRIES ?? 3,
          'integrations.falSupportsReference': env.FAL_IMAGE_SUPPORTS_REFERENCE,
          'integrations.falSupportsNegativePrompt': env.FAL_IMAGE_SUPPORTS_NEGATIVE_PROMPT,
        };
        return map[key] ?? defaultValue;
      },
    } as ConfigService;

    return new FalProvider(config);
  }

  it('uses mock mode when FAL_USE_MOCK=true or API key is missing and returns a PNG buffer and cost estimate', async () => {
    process.env.NODE_ENV = 'test';
    const provider = createProvider({ FAL_USE_MOCK: 'true' });

    expect(provider.shouldUseMock()).toBe(true);

    const result = await provider.generateImage({
      prompt: 'Cinematic portrait of a founder in warm morning light',
      negativePrompt: 'cartoon, anime',
      aspectRatio: '9:16',
      seed: 123,
      numImages: 2,
      referenceImageUrls: ['https://cdn.example.com/ref.png'],
    });

    expect(result.model).toBe('mock:fal-ai/flux/dev');
    expect(result.seed).toBe(123);
    expect(result.currency).toBe('USD');
    expect(result.estimatedCostUsd).toBe(0.05);
    expect(result.usedReferenceImages).toBe(false);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mock).toBe(true);
    expect(result.images[0]?.contentType).toBe('image/png');
    expect(Buffer.isBuffer(result.images[0]?.buffer)).toBe(true);
    expect(result.images[0]?.buffer?.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(result.images[0]?.buffer?.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('respects FAL_USE_MOCK=true even when FAL_API_KEY and non-test NODE_ENV are set', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FAL_USE_MOCK;

    const provider = createProvider({
      FAL_API_KEY: 'fal-live-key',
      FAL_USE_MOCK: 'true',
    });

    expect(provider.isConfigured()).toBe(true);
    expect(provider.shouldUseMock()).toBe(true);

    const result = await provider.generateImage({
      prompt: 'Mock mode respected in production config',
    });
    expect(result.images[0]?.mock).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns fal-ai/flux/dev capabilities without reference images and allows opt-in models', () => {
    const provider = createProvider({ FAL_IMAGE_MODEL: 'fal-ai/flux/dev' });

    const fluxCaps = provider.getCapabilities();
    expect(fluxCaps.modelId).toBe('fal-ai/flux/dev');
    expect(fluxCaps.supportsReferenceImages).toBe(false);
    expect(fluxCaps.supportsSeed).toBe(true);
    expect(fluxCaps.supportsNegativePrompt).toBe(false);

    const pulidCaps = provider.getCapabilities('fal-ai/flux-pulid');
    expect(pulidCaps.supportsReferenceImages).toBe(true);
    expect(pulidCaps.supportsNegativePrompt).toBe(true);
  });

  it('computes pricing using getFalPricingFromEnv and estimateFalImageCostUsd', () => {
    const pricing = getFalPricingFromEnv({
      FAL_IMAGE_PRICE_PER_IMAGE: '0.03',
      FAL_IMAGE_CURRENCY: 'USD',
    });
    expect(pricing).toEqual({ pricePerImageUsd: 0.03, currency: 'USD' });
    expect(estimateFalImageCostUsd(4, pricing)).toBe(0.12);

    const provider = createProvider({
      FAL_USE_MOCK: 'true',
      FAL_IMAGE_PRICE_PER_IMAGE: '0.03',
      FAL_IMAGE_CURRENCY: 'USD',
    });
    return provider
      .generateImage({ prompt: 'Pricing test', numImages: 3 })
      .then((res) => {
        expect(res.estimatedCostUsd).toBe(0.09);
        expect(res.currency).toBe('USD');
      });
  });

  it('retries transient HTTP/network failures when mock mode is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FAL_USE_MOCK;

    const provider = createProvider({
      FAL_API_KEY: 'test-key',
      FAL_USE_MOCK: 'false',
      FAL_IMAGE_MAX_RETRIES: 2,
    });

    expect(provider.shouldUseMock()).toBe(false);

    const transientError = Object.assign(new Error('Request failed with status 429'), {
      response: { status: 429 },
    });

    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockedAxios.post
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        data: {
          images: [{ url: 'https://fal.media/out.png', width: 576, height: 1024, content_type: 'image/png' }],
          seed: 77,
        },
      });
    mockedAxios.get.mockResolvedValueOnce({
      data: fakePng.buffer.slice(fakePng.byteOffset, fakePng.byteOffset + fakePng.byteLength),
    });

    const result = await provider.generateImage({ prompt: 'Retry transient test' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.buffer).toEqual(fakePng);
    expect(result.estimatedCostUsd).toBe(0.025);
  });

  it('does not retry non-transient errors when mock mode is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FAL_USE_MOCK;

    const provider = createProvider({
      FAL_API_KEY: 'test-key',
      FAL_USE_MOCK: 'false',
      FAL_IMAGE_MAX_RETRIES: 3,
    });

    const badRequestError = Object.assign(new Error('Invalid prompt parameter'), {
      response: { status: 400 },
    });
    mockedAxios.post.mockRejectedValueOnce(badRequestError);

    await expect(
      provider.generateImage({ prompt: 'Bad request' }),
    ).rejects.toThrow('Invalid prompt parameter');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
