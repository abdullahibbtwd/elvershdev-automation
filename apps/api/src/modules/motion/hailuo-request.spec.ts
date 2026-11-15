import {
  buildHailuoImageToVideoRequest,
  estimateHailuoVideoCostUsd,
  getDefaultVideoProviderId,
  getHailuoModelCapabilities,
  isKlingVideoProviderEnabled,
  mapFalQueueStatusToVideoStatus,
  normalizeVideoProviderId,
} from '@ai-video/shared';

describe('Phase 6.1 Hailuo request + pricing + provider selection', () => {
  it('builds the official fal.ai Hailuo-02 Standard request schema', () => {
    const validated = buildHailuoImageToVideoRequest({
      prompt: 'Man walked into winter cave with polar bear',
      imageUrl:
        'https://storage.googleapis.com/falserverless/model_tests/minimax/example.png',
      durationSeconds: 6,
      resolution: '768P',
      promptOptimizer: true,
    });

    expect(validated.body).toEqual({
      prompt: 'Man walked into winter cave with polar bear',
      image_url:
        'https://storage.googleapis.com/falserverless/model_tests/minimax/example.png',
      duration: '6',
      resolution: '768P',
      prompt_optimizer: true,
    });
    expect(validated.endpointId).toBe(
      'fal-ai/minimax/hailuo-02/standard/image-to-video',
    );
  });

  it('allows end_image_url only at 768P', () => {
    expect(() =>
      buildHailuoImageToVideoRequest({
        prompt: 'Resolve to final frame',
        imageUrl: 'https://example.com/start.png',
        resolution: '512P',
        endImageUrl: 'https://example.com/end.png',
      }),
    ).toThrow(/768P/);

    const ok = buildHailuoImageToVideoRequest({
      prompt: 'Resolve to final frame',
      imageUrl: 'https://example.com/start.png',
      resolution: '768P',
      endImageUrl: 'https://example.com/end.png',
    });
    expect(ok.body.end_image_url).toBe('https://example.com/end.png');
  });

  it('rejects non-HTTP image URLs and unsupported parameters by omission', () => {
    expect(() =>
      buildHailuoImageToVideoRequest({
        prompt: 'x',
        imageUrl: 'data:image/png;base64,abc',
      }),
    ).toThrow(/HTTP/);

    const body = buildHailuoImageToVideoRequest({
      prompt: 'Natural motion',
      imageUrl: 'https://example.com/a.png',
      durationSeconds: 10,
      resolution: '512P',
    }).body;

    expect(body).not.toHaveProperty('negative_prompt');
    expect(body).not.toHaveProperty('audio');
    expect(body.duration).toBe('10');
    expect(body.resolution).toBe('512P');
  });

  it('estimates Hailuo pricing at ~$0.27 for 6s 768P', () => {
    expect(
      estimateHailuoVideoCostUsd(6, '768P', {
        pricePerSecond768PUsd: 0.045,
        pricePerSecond512PUsd: 0.017,
        currency: 'USD',
      }),
    ).toBeCloseTo(0.27, 5);
  });

  it('maps fal queue statuses', () => {
    expect(mapFalQueueStatusToVideoStatus('IN_QUEUE')).toBe('submitted');
    expect(mapFalQueueStatusToVideoStatus('IN_PROGRESS')).toBe('processing');
    expect(mapFalQueueStatusToVideoStatus('COMPLETED')).toBe('succeeded');
    expect(mapFalQueueStatusToVideoStatus('FAILED')).toBe('failed');
  });

  it('defaults provider selection to hailuo and keeps Kling disabled', () => {
    expect(getDefaultVideoProviderId({ VIDEO_GENERATION_PROVIDER: 'hailuo' })).toBe(
      'hailuo',
    );
    expect(normalizeVideoProviderId('KLING')).toBe('kling');
    expect(isKlingVideoProviderEnabled({ KLING_ENABLED: 'false' })).toBe(false);
    expect(isKlingVideoProviderEnabled({ KLING_ENABLED: 'true' })).toBe(true);
  });

  it('exposes Hailuo capabilities for 6/10s and 512P/768P', () => {
    const caps = getHailuoModelCapabilities();
    expect(caps.supportedDurations).toEqual([6, 10]);
    expect(caps.supportedResolutions).toEqual(['512P', '768P']);
    expect(caps.cancelSupported).toBe(false);
    expect(caps.endpointId).toContain('hailuo-02/standard/image-to-video');
  });
});
