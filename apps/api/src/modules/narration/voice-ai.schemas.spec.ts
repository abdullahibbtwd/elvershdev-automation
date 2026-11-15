import {
  createMockNarrationPlan,
  createMockWavBuffer,
  createVoiceProfileSchema,
  estimateGeminiTtsCostUsd,
  estimateSpeakingDurationSeconds,
  GEMINI_PREBUILT_VOICES,
  generateSceneAudioSchema,
  generateStoryAudioSchema,
  getGeminiTtsPricingFromEnv,
  isWavBuffer,
  planNarrationSchema,
  plannedNarrationScriptSchema,
  updateNarrationScriptSchema,
  updateVoiceProfileSchema,
} from '@ai-video/shared';

describe('Phase 7 voice-ai schemas and pricing', () => {
  const sceneId = '11111111-1111-4111-8111-111111111111';

  it('lists curated Gemini prebuilt voices without preview audio', () => {
    expect(GEMINI_PREBUILT_VOICES.length).toBeGreaterThan(0);
    for (const voice of GEMINI_PREBUILT_VOICES) {
      expect(voice.id).toBeTruthy();
      expect(voice).not.toHaveProperty('previewAudioBase64');
    }
  });

  it('applies defaults to planNarrationSchema', () => {
    expect(planNarrationSchema.parse({})).toEqual({ regenerate: false, simulateFailure: false });
    expect(planNarrationSchema.parse({ regenerate: true, useMockAi: true }).useMockAi).toBe(true);
  });

  it('validates a planned narration script', () => {
    const plan = plannedNarrationScriptSchema.parse({
      fullText: 'Dawn broke over the workshop.',
      scenes: [
        {
          sceneId,
          sceneNumber: 1,
          text: 'Dawn broke over the workshop.',
          emotionalTone: 'warm',
          speakingStyle: 'calm and measured',
          estimatedDurationSeconds: 4.5,
          sequence: 1,
        },
      ],
    });
    expect(plan.scenes[0].deliveryInstructions).toBe('');
    expect(plan.notes).toBe('');
  });

  it('rejects narration plans with empty scenes or invalid durations', () => {
    expect(plannedNarrationScriptSchema.safeParse({ fullText: 'x', scenes: [] }).success).toBe(
      false,
    );
    expect(
      plannedNarrationScriptSchema.safeParse({
        fullText: 'x',
        scenes: [
          {
            sceneNumber: 1,
            text: 'x',
            emotionalTone: 'warm',
            speakingStyle: 'calm',
            estimatedDurationSeconds: -1,
            sequence: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates update narration script payloads', () => {
    const parsed = updateNarrationScriptSchema.parse({
      scenes: [{ id: sceneId, text: 'Updated narration', speakingStyle: 'upbeat' }],
    });
    expect(parsed.scenes?.[0].text).toBe('Updated narration');

    expect(updateNarrationScriptSchema.safeParse({ scenes: [] }).success).toBe(false);
    expect(
      updateNarrationScriptSchema.safeParse({ scenes: [{ id: 'not-a-uuid' }] }).success,
    ).toBe(false);
  });

  it('validates generate audio schemas and voice ids', () => {
    const story = generateStoryAudioSchema.parse({
      providerVoiceId: 'Kore',
      sceneIds: [sceneId],
    });
    expect(story.forceRegenerate).toBe(false);
    expect(story.providerVoiceId).toBe('Kore');

    expect(generateStoryAudioSchema.safeParse({ providerVoiceId: 'NotAVoice' }).success).toBe(
      false,
    );
    expect(generateStoryAudioSchema.safeParse({ sceneIds: [] }).success).toBe(false);

    const scene = generateSceneAudioSchema.parse({ forceRegenerate: true });
    expect(scene.forceRegenerate).toBe(true);
    expect('sceneIds' in scene).toBe(false);
  });

  it('validates voice profile create/update schemas', () => {
    const created = createVoiceProfileSchema.parse({
      name: 'Narrator',
      providerVoiceId: 'Kore',
      configuration: { speakingStyle: 'warm' },
    });
    expect(created.provider).toBe('gemini');
    expect(created.language).toBe('en');
    expect(created.isDefault).toBe(false);

    expect(
      createVoiceProfileSchema.safeParse({ name: 'Bad', providerVoiceId: 'Nope' }).success,
    ).toBe(false);
    expect(
      createVoiceProfileSchema.safeParse({
        name: 'Strict',
        providerVoiceId: 'Kore',
        configuration: { unknownField: true },
      }).success,
    ).toBe(false);

    expect(updateVoiceProfileSchema.parse({ isDefault: true }).isDefault).toBe(true);
    expect(updateVoiceProfileSchema.parse({})).toEqual({});
  });

  it('estimates TTS cost from configurable pricing', () => {
    const pricing = {
      model: 'gemini-3.8-flash-lite-tts',
      priceInputPerMillionUsd: 0.5,
      priceAudioOutputPerMillionUsd: 6,
      audioTokensPerSecond: 25,
      currency: 'USD',
    };
    // 40 chars => 10 input tokens; 10s => 250 audio tokens
    const cost = estimateGeminiTtsCostUsd('a'.repeat(40), 10, pricing);
    expect(cost).toBeCloseTo((10 / 1e6) * 0.5 + (250 / 1e6) * 6, 6);

    const fromEnv = getGeminiTtsPricingFromEnv({
      GEMINI_TTS_MODEL: 'gemini-3.8-flash-tts',
      GEMINI_TTS_PRICE_AUDIO_OUTPUT_PER_MILLION_USD: '12',
    });
    expect(fromEnv.priceAudioOutputPerMillionUsd).toBe(12);
    expect(fromEnv.priceInputPerMillionUsd).toBe(0.5);
  });

  it('estimates speaking duration from word count', () => {
    expect(estimateSpeakingDurationSeconds(Array(150).fill('word').join(' '))).toBe(60);
    expect(estimateSpeakingDurationSeconds('')).toBeGreaterThanOrEqual(0.5);
  });

  it('creates deterministic mock narration and a valid mock WAV', () => {
    const plan = createMockNarrationPlan({
      title: 'Dawn Workshop',
      story: 'A maker begins again.',
      language: 'en',
      characters: [{ name: 'Ava' }],
      scenes: [
        {
          sceneId,
          sceneNumber: 1,
          durationSeconds: 5,
          narration: 'She opens the shutters.',
        },
      ],
    });
    expect(plannedNarrationScriptSchema.safeParse(plan).success).toBe(true);
    expect(plan.scenes[0].text).toBe('She opens the shutters.');

    const wav = createMockWavBuffer({ text: 'hello', voiceId: 'Kore' });
    expect(isWavBuffer(wav)).toBe(true);
  });
});
