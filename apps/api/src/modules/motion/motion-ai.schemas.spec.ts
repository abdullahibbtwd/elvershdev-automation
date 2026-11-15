import {
  createMockMotionAnalysis,
  createMockMp4Buffer,
  estimateHailuoVideoCostUsd,
  estimateKlingVideoCostUsd,
  getHailuoModelCapabilities,
  getKlingModelCapabilities,
  motionAnalysisBatchSchema,
  motionBriefSchema,
  generateStoryMotionSchema,
  generateSceneMotionSchema,
  updateMotionGenerationSchema,
} from '@ai-video/shared';

describe('Phase 6 motion-ai schemas and pricing', () => {
  it('validates a motion brief', () => {
    const brief = motionBriefSchema.parse({
      mainSubject: 'A craftsman at a workbench',
      characterMovement: 'Gentle head turn',
      facialExpressions: 'Focused calm',
      bodyMovement: 'Subtle hand adjustment',
      environmentalMovement: 'Dust motes drifting',
      cameraMovement: 'Slow push-in',
      cameraAngle: 'eye-level',
      cameraDistance: 'medium',
      sceneAtmosphere: 'warm workshop',
      lightingContinuity: 'golden hour continuity',
      movementSpeed: 'slow',
      emotionalIntention: 'quiet determination',
      startFrameConsistency: 'preserve clothing and face',
      endFrameComposition: 'hold natural end pose',
      motionPrompt: 'Slow cinematic push-in on the craftsman.',
      negativePrompt: 'morphing, cartoon',
    });
    expect(brief.motionPrompt.length).toBeGreaterThan(5);
  });

  it('validates motion analysis batch and request DTOs', () => {
    const batch = motionAnalysisBatchSchema.parse({
      scenes: [
        {
          sceneNumber: 1,
          mainSubject: 'Subject',
          characterMovement: 'Walk',
          facialExpressions: 'Smile',
          bodyMovement: 'Step forward',
          environmentalMovement: 'Leaves',
          cameraMovement: 'Pan',
          cameraAngle: 'eye-level',
          cameraDistance: 'wide',
          sceneAtmosphere: 'hopeful',
          lightingContinuity: 'soft daylight',
          movementSpeed: 'natural',
          emotionalIntention: 'hope',
          startFrameConsistency: 'same person',
          endFrameComposition: 'centered',
          motionPrompt: 'Person walks naturally toward camera.',
          negativePrompt: 'blur',
        },
      ],
    });
    expect(batch.scenes).toHaveLength(1);

    expect(
      generateStoryMotionSchema.parse({
        provider: 'hailuo',
        durationSeconds: 6,
        resolution: '768P',
        sceneIds: ['11111111-1111-4111-8111-111111111111'],
      }).durationSeconds,
    ).toBe(6);

    expect(
      generateStoryMotionSchema.parse({
        provider: 'kling',
        durationSeconds: 5,
        resolution: '720p',
        sceneIds: ['11111111-1111-4111-8111-111111111111'],
      }).durationSeconds,
    ).toBe(5);

    expect(
      generateSceneMotionSchema.parse({
        motionPrompt: 'Gentle head movement',
        skipAnalysis: true,
      }).skipAnalysis,
    ).toBe(true);

    expect(
      updateMotionGenerationSchema.parse({
        isSelected: true,
        motionPrompt: 'Updated prompt',
      }).isSelected,
    ).toBe(true);
  });

  it('creates deterministic mock motion analysis', () => {
    const mock = createMockMotionAnalysis({
      title: 'Dawn Workshop',
      story: 'A maker begins again.',
      defaultDurationSeconds: 5,
      characters: [
        {
          name: 'Ava',
          appearance: 'warm brown eyes',
          clothing: 'linen apron',
          ageRange: '30s',
          hair: 'dark bun',
          distinctiveFeatures: 'scar on left hand',
          consistencyNotes: 'keep apron',
        },
      ],
      scenes: [
        {
          sceneNumber: 1,
          durationSeconds: 5,
          narration: 'She opens the shutters.',
          visualDescription: 'Woman opening workshop shutters at dawn',
          imagePrompt: 'photoreal dawn workshop',
          videoPrompt: 'slow push-in',
          cameraMovement: 'slow push-in',
          lighting: 'dawn light',
          environment: 'wooden workshop',
          characterConsistencyInstructions: 'keep Ava identity',
        },
      ],
    });
    expect(mock.scenes[0].motionPrompt.toLowerCase()).toContain('first frame');
    expect(mock.scenes[0].negativePrompt.toLowerCase()).toContain('morphing');
  });

  it('estimates Kling cost from configurable pricing', () => {
    const cost = estimateKlingVideoCostUsd(5, '720p', {
      pricePerSecondUsd: 0.1,
      currency: 'USD',
    });
    expect(cost).toBe(0.5);
  });

  it('estimates Hailuo cost from configurable pricing', () => {
    const cost = estimateHailuoVideoCostUsd(6, '768P', {
      pricePerSecond768PUsd: 0.045,
      pricePerSecond512PUsd: 0.017,
      currency: 'USD',
    });
    expect(cost).toBeCloseTo(0.27, 5);
  });

  it('exposes Kling 2.6 capabilities from official model path', () => {
    const caps = getKlingModelCapabilities('kling-2.6');
    expect(caps.submitPath).toBe('/image-to-video/kling-2.6');
    expect(caps.supportedDurations).toEqual([5, 10]);
    expect(caps.supportedResolutions).toEqual(['720p', '1080p']);
    expect(caps.cancelSupported).toBe(false);
  });

  it('exposes Hailuo-02 Standard capabilities', () => {
    const caps = getHailuoModelCapabilities();
    expect(caps.endpointId).toBe('fal-ai/minimax/hailuo-02/standard/image-to-video');
    expect(caps.supportedDurations).toEqual([6, 10]);
    expect(caps.supportedResolutions).toEqual(['512P', '768P']);
  });

  it('returns a valid mock MP4 buffer with ftyp signature', () => {
    const buffer = Buffer.from(createMockMp4Buffer());
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.includes(Buffer.from('ftyp'))).toBe(true);
  });
});
