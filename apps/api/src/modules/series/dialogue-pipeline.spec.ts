import {
  buildSpeakingStyleForEmotion,
  createMockDialogueEpisodeScript,
  dedupeProviderUsageCostUsd,
  dialogueEpisodeScriptPlanSchema,
  dialoguePlanToEpisodeScriptPlan,
  estimateDialogueEpisodeCost,
  estimateKlingAvatarCostUsd,
  estimateLipSyncCostUsd,
  flattenDialogueLines,
  getLipSyncCapabilities,
  normalizeDialogueEpisodeScriptPlanInput,
  pickStableGeminiVoiceForCharacter,
  planShotCosts,
  resolveLipSyncProviderId,
  validateDialogueSpeakers,
} from '@ai-video/shared';

describe('dialogue-driven pipeline (shared foundation)', () => {
  it('validates mock dialogue script with two speakers', () => {
    const plan = dialogueEpisodeScriptPlanSchema.parse(
      createMockDialogueEpisodeScript({ episodeNumber: 1 }),
    );
    expect(flattenDialogueLines(plan).length).toBeGreaterThanOrEqual(2);
    expect(validateDialogueSpeakers(plan, ['Tunde', 'Kemi', 'Ada', 'Mother'])).toEqual([]);
  });

  it('rejects unknown speakers', () => {
    const plan = createMockDialogueEpisodeScript({ episodeNumber: 1 });
    expect(
      validateDialogueSpeakers(plan, ['Kemi']).some((e) => e.includes('unknown speaker')),
    ).toBe(true);
  });

  it('normalizes snake_case dialogue fields', () => {
    const normalized = normalizeDialogueEpisodeScriptPlanInput({
      episodeNumber: 1,
      title: 'Test',
      synopsis: 's',
      hook: 'h',
      ending: 'e',
      nextEpisodeSetup: 'n',
      keyPlotDevelopment: 'k',
      spokenWordCount: 10,
      script: 'A: hi\nB: hello',
      scenes: [
        {
          scene_number: 1,
          duration_seconds: 10,
          location: 'Room',
          characters: ['A', 'B'],
          background_environment: 'Room',
          emotional_direction: 'tense',
          action: 'talk',
          visual_description: '3d',
          shots: [
            {
              shot_order: 1,
              speaker: 'A',
              dialogue: 'hi',
              emotion: 'calm',
              facial_expression: 'soft',
              body_language: 'still',
              camera_direction: 'close',
              characters_visible: ['A'],
              environment: 'Room',
              duration_seconds: 3,
            },
            {
              shot_order: 2,
              speaker: 'B',
              dialogue: 'hello',
              emotion: 'calm',
              facialExpression: 'open',
              bodyLanguage: 'nod',
              cameraDirection: 'reverse',
              charactersVisible: ['B'],
              environment: 'Room',
              durationSeconds: 3,
            },
          ],
        },
        {
          sceneNumber: 2,
          durationSeconds: 8,
          location: 'Hall',
          characters: ['A', 'B'],
          backgroundEnvironment: 'Hall',
          emotionalDirection: 'resolve',
          action: 'leave',
          visualDescription: '3d',
          shots: [
            {
              shotOrder: 1,
              speaker: 'A',
              dialogue: 'later',
              emotion: 'calm',
              facialExpression: 'firm',
              bodyLanguage: 'turn',
              cameraDirection: 'medium',
              charactersVisible: ['A'],
              environment: 'Hall',
              durationSeconds: 4,
            },
          ],
        },
      ],
      continuityChanges: {},
      memoryEvents: [],
    });
    expect(normalized.scenes[0]!.shots[0]!.speaker).toBe('A');
  });

  it('adapts dialogue plan for continuity/legacy path', () => {
    const legacy = dialoguePlanToEpisodeScriptPlan(
      createMockDialogueEpisodeScript({ episodeNumber: 2 }),
    );
    expect(legacy.scenes[0]!.dialogue).toContain('Tunde:');
  });

  it('keeps stable distinct character voices', () => {
    const a = pickStableGeminiVoiceForCharacter('Kemi');
    expect(pickStableGeminiVoiceForCharacter('Kemi')).toBe(a);
    expect(pickStableGeminiVoiceForCharacter('Tunde', [a])).not.toBe(a);
    expect(buildSpeakingStyleForEmotion('natural', 'angry')).toContain('angry');
  });

  it('documents lip-sync providers without inventing Hailuo lip-sync', () => {
    const caps = getLipSyncCapabilities('kling_avatar_v2_standard');
    expect(caps.endpointId).toBe('fal-ai/kling-video/ai-avatar/v2/standard');
    expect(caps.supportsAudioDrivenLipSync).toBe(true);
    expect(getLipSyncCapabilities('omnihuman').maxAudioSeconds).toBe(30);
    expect(estimateLipSyncCostUsd('kling_avatar_v2_standard', 10)).toBeCloseTo(0.562, 5);
    expect(resolveLipSyncProviderId({ NODE_ENV: 'test' })).toBe('mock');
    expect(caps.endpointId.includes('hailuo')).toBe(false);
  });

  it('plans hybrid dialogue costs without Hailuo for reactions', () => {
    expect(estimateKlingAvatarCostUsd(15.466)).toBeCloseTo(0.8692, 3);
    const planned = planShotCosts([
      {
        shotType: 'close_up',
        dialogue: 'Stop it',
        durationSeconds: 3,
        requiresLipSync: true,
        speaker: 'Kemi',
      },
      {
        shotType: 'reaction',
        dialogue: '',
        durationSeconds: 2,
        requiresLipSync: false,
        speaker: 'Tunde',
      },
    ]);
    expect(planned[0]!.productionMethod).toBe('kling_avatar_lip_sync');
    expect(planned[1]!.productionMethod).toBe('ffmpeg_still_motion');
    const estimate = estimateDialogueEpisodeCost({
      mode: 'balanced',
      episodeTargetSeconds: 50,
      newPortraitCount: 0,
      shots: planned,
    });
    expect(estimate.estimatedHailuoUsd).toBe(0);
    expect(estimate.estimatedTotalUsd).toBeLessThan(1);
    expect(
      dedupeProviderUsageCostUsd([
        { provider: 'hailuo', requestType: 'image_to_video_submit', estimatedCost: 0.27 },
        { provider: 'hailuo', requestType: 'image_to_video_complete', estimatedCost: 0.27 },
      ]),
    ).toBeCloseTo(0.27, 5);
  });
});
