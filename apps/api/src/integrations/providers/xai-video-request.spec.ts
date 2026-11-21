import {
  assertXaiLiteModel,
  buildXaiImageToVideoRequest,
  buildXaiTextToVideoRequest,
  costUsdFromXaiTicks,
  estimateXaiVideoCostUsd,
  isXaiVideoProviderEnabled,
  mapXaiPollStatus,
  normalizeVideoProviderId,
  normalizeXaiVideoDuration,
  normalizeXaiVideoResolution,
  parseXaiSubmitResponse,
  XAI_VIDEO_LITE_MODEL,
} from '@ai-video/shared';

describe('xAI video shared helpers', () => {
  it('locks model to Lite only', () => {
    expect(assertXaiLiteModel(XAI_VIDEO_LITE_MODEL)).toBe(XAI_VIDEO_LITE_MODEL);
    expect(() => assertXaiLiteModel('grok-imagine-video-1.5')).toThrow(
      /Only grok-imagine-video-1.5-lite/,
    );
  });

  it('builds text-to-video and image-to-video request bodies', () => {
    expect(
      buildXaiTextToVideoRequest({
        prompt: 'Two actors talk in a rainy street',
        durationSeconds: 10,
        resolution: '720p',
        aspectRatio: '9:16',
      }),
    ).toEqual({
      model: XAI_VIDEO_LITE_MODEL,
      prompt: 'Two actors talk in a rainy street',
      duration: 10,
      resolution: '720p',
      aspect_ratio: '9:16',
    });

    expect(
      buildXaiTextToVideoRequest({
        prompt: 'Landscape fallback when omitted uses vertical default',
        durationSeconds: 4,
        resolution: '720p',
      }).aspect_ratio,
    ).toBe('9:16');

    const i2v = buildXaiImageToVideoRequest({
      prompt: 'The character turns and smiles',
      imageUrl: 'https://example.com/portrait.png',
      durationSeconds: 6,
      resolution: '720p',
      aspectRatio: '9:16',
    });
    expect(i2v.model).toBe(XAI_VIDEO_LITE_MODEL);
    expect(i2v.image).toEqual({ url: 'https://example.com/portrait.png' });
    expect(i2v.aspect_ratio).toBe('9:16');
  });

  it('normalizes duration/resolution and maps poll status', () => {
    expect(normalizeXaiVideoDuration(0)).toBe(1);
    expect(normalizeXaiVideoDuration(20)).toBe(15);
    expect(normalizeXaiVideoResolution('1080')).toBe('1080p');
    expect(mapXaiPollStatus('pending')).toBe('submitted');
    expect(mapXaiPollStatus('done')).toBe('succeeded');
    expect(parseXaiSubmitResponse({ request_id: 'abc-123' })).toEqual({
      request_id: 'abc-123',
    });
  });

  it('prices 720p at $0.03/sec and recognizes provider id', () => {
    expect(costUsdFromXaiTicks(10_000_000_000)).toBe(1);
    expect(estimateXaiVideoCostUsd(10, '720p')).toBeCloseTo(0.3, 5);
    expect(normalizeVideoProviderId('grok')).toBe('xai');
    expect(isXaiVideoProviderEnabled({ XAI_VIDEO_ENABLED: 'true' })).toBe(true);
  });
});
