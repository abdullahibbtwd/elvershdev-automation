import {
  assertClipPlanValid,
  buildEpisodeClipPlan,
  splitShotIntoClipSegments,
} from '@ai-video/shared';

describe('Phase 3 clip planner', () => {
  const episode = {
    episodeNumber: 1,
    episodeTitle: 'The Argument',
    episodeSummary: 'Two siblings confront a secret.',
    targetDurationSeconds: 60,
    maxClipDurationSeconds: 15,
    visualStyle: 'Realistic cinematic drama',
  };

  it('never produces clips longer than maxClipDurationSeconds', () => {
    const plan = buildEpisodeClipPlan({
      episode,
      shots: [
        {
          id: 's1',
          sceneOrder: 1,
          shotOrder: 1,
          speakerName: 'Amina',
          dialogue: 'You knew about the will.',
          charactersVisible: ['Amina', 'Tunde'],
          cameraDirection: 'Close on Amina',
          facialExpression: 'hurt',
          bodyLanguage: 'tight shoulders',
          environment: 'Dim living room',
          durationSeconds: 8,
        },
        {
          id: 's2',
          sceneOrder: 1,
          shotOrder: 2,
          speakerName: 'Tunde',
          dialogue: 'I was protecting you.',
          charactersVisible: ['Amina', 'Tunde'],
          cameraDirection: 'OTS on Tunde',
          facialExpression: 'defensive',
          bodyLanguage: 'steps back',
          environment: 'Dim living room',
          durationSeconds: 10,
        },
        {
          id: 's3',
          sceneOrder: 1,
          shotOrder: 3,
          speakerName: null,
          dialogue: '',
          charactersVisible: ['Amina'],
          cameraDirection: 'Reaction close-up',
          facialExpression: 'shocked',
          bodyLanguage: 'still',
          environment: 'Dim living room',
          durationSeconds: 4,
        },
      ],
      characters: [
        {
          name: 'Amina',
          ageRange: '28',
          genderPresentation: 'woman',
          skinTone: 'deep brown',
          facialStructure: 'oval face',
          eyeColor: 'dark brown',
          hairstyle: 'braided bun',
          clothing: 'cream blouse',
          personality: 'guarded',
          physicalDescription: 'tall, composed',
        },
        {
          name: 'Tunde',
          ageRange: '32',
          genderPresentation: 'man',
          skinTone: 'medium brown',
          facialStructure: 'square jaw',
          eyeColor: 'brown',
          hairstyle: 'short fade',
          clothing: 'navy shirt',
          personality: 'defensive',
          physicalDescription: 'stocky',
        },
      ],
    });

    assertClipPlanValid(plan);
    expect(plan.clipCount).toBeGreaterThan(0);
    expect(plan.clips.every((c) => c.durationSeconds <= 15)).toBe(true);
    expect(plan.clips.some((c) => c.prompt.includes('Amina'))).toBe(true);
    expect(plan.clips[0]?.dialogue).toContain('will');
    expect(plan.estimatedCostUsd).toBeCloseTo(plan.totalDurationSeconds * 0.03, 5);
  });

  it('splits shots longer than 15s into connected segments', () => {
    const segments = splitShotIntoClipSegments(
      {
        sceneOrder: 2,
        shotOrder: 1,
        speakerName: 'Amina',
        dialogue: 'This ends tonight.',
        charactersVisible: ['Amina'],
        durationSeconds: 28,
        cameraDirection: 'Slow push-in',
        environment: 'Courtyard',
      },
      15,
    );
    expect(segments.length).toBe(2);
    expect(segments.every((s) => s.durationSeconds <= 15)).toBe(true);
    expect(segments[0]?.dialogue).toContain('ends tonight');
    expect(segments[1]?.dialogue).toBe('');
  });

  it('synthesizes speaking shots from literary screenplay so dialogue is not buried in action', () => {
    const plan = buildEpisodeClipPlan({
      episode: {
        ...episode,
        targetDurationSeconds: 30,
        episodeSummary:
          'Elena confronts Leo about Claire then learns the ring was restored for a proposal.',
        episodeScript: [
          'SCENE 1 - INT. LIVING ROOM - NIGHT',
          'Elena stares at the phone and packs her bag.',
          'SCENE 2 - INT. FOYER - CONTINUOUS',
          'Leo enters wet from the rain.',
          'ELENA',
          'Three years together, Leo! Who is Claire, and why are you sending her thousands in secret?',
          'LEO',
          'Elena, wait! Put the bag down, it\'s not what you think!',
          'ELENA',
          'Your stammering says everything. I\'m done.',
          'SCENE 3 - INT. THRESHOLD - CONTINUOUS',
          'LEO',
          'Stop! Claire is an antique jeweler! Will you marry me?',
          'ELENA',
          'My mother\'s ring? Oh God, Leo... yes!',
        ].join('\n'),
      },
      shots: [],
    });
    expect(plan.notes.join(' ')).toMatch(/synthesized/i);
    expect(plan.clips.every((c) => c.durationSeconds <= 15)).toBe(true);
    expect(plan.clipCount).toBeGreaterThanOrEqual(4);
    const spoken = plan.clips.map((c) => c.dialogue).filter(Boolean);
    expect(spoken.some((d) => /Who is Claire/i.test(d))).toBe(true);
    expect(spoken.some((d) => /marry me/i.test(d))).toBe(true);
    // Each speaking clip should put the line in DIALOGUE, not only ACTION
    const claireClip = plan.clips.find((c) => /Who is Claire/i.test(c.dialogue));
    expect(claireClip?.prompt).toMatch(/DIALOGUE \(speak only these lines/);
    expect(claireClip?.prompt).toMatch(/Who is Claire/);
    expect(plan.clips[0]?.action).not.toEqual(plan.clips[1]?.action);
    // Story props mentioned in the screenplay must surface in Grok prompts
    const propClip = plan.clips.find(
      (c) =>
        c.keyProps.some((p) => /phone|bag|ring/i.test(p)) ||
        /PROPS \/ KEY OBJECTS[\s\S]*smartphone|PROPS \/ KEY OBJECTS[\s\S]*bag|PROPS \/ KEY OBJECTS[\s\S]*ring/i.test(
          c.prompt,
        ),
    );
    expect(propClip).toBeTruthy();
    expect(propClip!.prompt).toMatch(/MUST be clearly visible|SHOW ON CAMERA/i);
  });

  it('locks explicit keyProps into every Grok clip prompt', () => {
    const plan = buildEpisodeClipPlan({
      episode: { ...episode, targetDurationSeconds: 20 },
      shots: [
        {
          sceneOrder: 1,
          shotOrder: 1,
          speakerName: 'Elena',
          dialogue: 'Look at this message.',
          charactersVisible: ['Elena'],
          bodyLanguage: 'holding phone toward camera',
          durationSeconds: 6,
          keyProps: ['smartphone', 'engagement ring'],
        },
        {
          sceneOrder: 1,
          shotOrder: 2,
          speakerName: 'Leo',
          dialogue: 'That ring is for you.',
          charactersVisible: ['Leo'],
          durationSeconds: 6,
          keyProps: ['engagement ring'],
        },
      ],
    });
    expect(plan.clips.some((c) => c.keyProps.includes('smartphone'))).toBe(true);
    expect(plan.clips.some((c) => c.keyProps.includes('engagement ring'))).toBe(true);
    expect(plan.clips.every((c) => c.prompt.includes('PROPS / KEY OBJECTS'))).toBe(true);
    expect(
      plan.clips.some((c) =>
        /MUST be clearly visible in frame:[\s\S]*smartphone/i.test(c.prompt),
      ),
    ).toBe(true);
  });

  it('parses inline NAME: lines without chopping LEO into O:', () => {
    const plan = buildEpisodeClipPlan({
      episode: {
        ...episode,
        targetDurationSeconds: 30,
        episodeScript:
          "LEO: Hey, El. Rain's brutal out there. Why's your bag packed? ELENA: Ask Claire. Who is she, Leo? LEO: Wait. Put the phone down. ELENA: Then explain it!",
      },
      shots: [],
    });
    const joined = plan.clips.map((c) => c.dialogue).filter(Boolean).join('\n');
    expect(joined).toMatch(/Ask Claire/i);
    expect(joined).toMatch(/explain it/i);
    expect(plan.clips.some((c) => c.speakerName === 'LEO' || /LEO:/i.test(c.dialogue))).toBe(
      true,
    );
    expect(plan.clips.every((c) => c.speakerName !== 'O')).toBe(true);
  });

  it('rejects plans where two clips share the same action beat', () => {
    const plan = buildEpisodeClipPlan({
      episode,
      shots: [
        {
          sceneOrder: 1,
          shotOrder: 1,
          speakerName: 'Amina',
          dialogue: 'You knew.',
          charactersVisible: ['Amina'],
          durationSeconds: 8,
          facialExpression: 'hurt',
          bodyLanguage: 'still',
        },
        {
          sceneOrder: 1,
          shotOrder: 2,
          speakerName: 'Tunde',
          dialogue: 'I was protecting you.',
          charactersVisible: ['Tunde'],
          durationSeconds: 8,
          facialExpression: 'defensive',
          bodyLanguage: 'steps back',
        },
      ],
    });
    // Sanity: valid distinct plan passes
    assertClipPlanValid(plan);
    expect(() =>
      assertClipPlanValid({
        ...plan,
        clips: plan.clips.map((c, i) =>
          i === 1 ? { ...c, action: plan.clips[0]!.action, dialogue: plan.clips[0]!.dialogue } : c,
        ),
      }),
    ).toThrow(/same action beat|same dialogue/i);
  });
});
