import {
  getLipSyncCapabilities,
  resolveLipSyncProviderId,
} from './capabilities';
import { estimateLipSyncCostUsd } from './pricing';

describe('lip-sync capabilities', () => {
  it('documents Kling Avatar v2 Standard as audio-driven lip-sync', () => {
    const caps = getLipSyncCapabilities('kling_avatar_v2_standard');
    expect(caps.supportsAudioDrivenLipSync).toBe(true);
    expect(caps.endpointId).toBe('fal-ai/kling-video/ai-avatar/v2/standard');
    expect(caps.pricePerSecondUsd).toBe(0.0562);
  });

  it('documents OmniHuman 30s audio limit', () => {
    expect(getLipSyncCapabilities('omnihuman').maxAudioSeconds).toBe(30);
  });

  it('resolves mock in test env', () => {
    expect(resolveLipSyncProviderId({ NODE_ENV: 'test' })).toBe('mock');
  });

  it('estimates cost linearly', () => {
    expect(estimateLipSyncCostUsd('kling_avatar_v2_standard', 10)).toBeCloseTo(0.562, 5);
  });

  it('never claims Hailuo endpoint as lip-sync provider', () => {
    const ids = [
      'kling_avatar_v2_standard',
      'kling_avatar_v2_pro',
      'omnihuman',
      'mock',
    ] as const;
    for (const id of ids) {
      expect(getLipSyncCapabilities(id).endpointId).not.toContain('hailuo');
    }
  });
});
