import {
  buildAss,
  buildSrt,
  planRenderTimeline,
  splitNarrationIntoSubtitleSegments,
  subtitleStyleSchema,
} from '@ai-video/shared';

describe('Phase 8 timeline planner', () => {
  const baseScene = {
    sceneId: 's1',
    sequence: 1,
    sceneNumber: 1,
    narrationText: 'Hello world. This is a longer second sentence for captions.',
    narrationDurationSeconds: 4,
    motionDurationSeconds: 5,
    hasMotionClip: true,
    hasImage: true,
    selectedMotionGenerationId: 'm1',
    selectedVisualId: 'v1',
    selectedAudioGenerationId: 'a1',
    motionStorageKey: 'motion.mp4',
    imageStorageKey: 'image.png',
    audioStorageKey: 'audio.wav',
  };

  it('plans narration-driven timing and trims longer motion', () => {
    const timeline = planRenderTimeline([baseScene], { scenePaddingSeconds: 0.2 });
    expect(timeline.sceneCount).toBe(1);
    expect(timeline.scenes[0].duration).toBeCloseTo(4.2, 5);
    expect(timeline.scenes[0].trimMotionToSeconds).toBeCloseTo(4.2, 5);
    expect(timeline.scenes[0].extendWithImageSeconds).toBe(0);
  });

  it('extends with image when narration exceeds motion', () => {
    const timeline = planRenderTimeline(
      [
        {
          ...baseScene,
          narrationDurationSeconds: 8,
          motionDurationSeconds: 5,
        },
      ],
      { scenePaddingSeconds: 0.2 },
    );
    expect(timeline.scenes[0].extendWithImageSeconds).toBeCloseTo(3.2, 5);
    expect(timeline.scenes[0].duration).toBeCloseTo(8.2, 5);
  });

  it('falls back to image when motion is missing', () => {
    const timeline = planRenderTimeline([
      {
        ...baseScene,
        hasMotionClip: false,
        motionDurationSeconds: null,
        selectedMotionGenerationId: null,
        motionStorageKey: null,
        narrationDurationSeconds: 3,
      },
    ]);
    expect(timeline.scenes[0].visualSource).toBe('image');
  });

  it('preserves scene order and cumulative start times', () => {
    const timeline = planRenderTimeline(
      [
        { ...baseScene, sceneId: 's2', sequence: 2, sceneNumber: 2, narrationDurationSeconds: 2 },
        { ...baseScene, sceneId: 's1', sequence: 1, sceneNumber: 1, narrationDurationSeconds: 3 },
      ],
      { scenePaddingSeconds: 0, audioMix: { sceneGapSeconds: 0.1 } },
    );
    expect(timeline.scenes.map((s) => s.sceneId)).toEqual(['s1', 's2']);
    expect(timeline.scenes[0].startTime).toBe(0);
    expect(timeline.scenes[1].startTime).toBeCloseTo(3.1, 5);
  });

  it('builds readable subtitle cues and SRT/ASS', () => {
    const style = subtitleStyleSchema.parse({});
    const cues = splitNarrationIntoSubtitleSegments(
      'First sentence here. Second sentence continues the idea carefully.',
      0,
      6,
      style,
      's1',
      1,
      1,
    );
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].startSeconds).toBe(0);
    const srt = buildSrt(cues);
    expect(srt).toContain('-->');
    const ass = buildAss(cues, style, 1080, 1920);
    expect(ass).toContain('[Events]');
  });
});
