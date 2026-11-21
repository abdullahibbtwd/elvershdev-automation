import {
  estimateGrokLiteCostFromDurationPlan,
  planClipDurationsForEpisode,
  resolveSeriesDurationPlan,
} from '@ai-video/shared';

describe('series duration plan', () => {
  it('preserves legacy 10×60s defaults when nothing is configured', () => {
    const plan = resolveSeriesDurationPlan({});
    expect(plan.productionFormat).toBe('episodic');
    expect(plan.episodeDurationSeconds).toBe(60);
    expect(plan.plannedEpisodeCount).toBe(10);
    expect(plan.storyDurationSeconds).toBe(600);
    expect(plan.maxClipDurationSeconds).toBe(15);
    expect(plan.derivation).toBe('defaults');
  });

  it('derives ~10 episodes from a 10-minute story with 60s episodes', () => {
    const plan = resolveSeriesDurationPlan({
      storyDurationSeconds: 600,
      episodeDurationSeconds: 60,
    });
    expect(plan.plannedEpisodeCount).toBe(10);
    expect(plan.episodes).toHaveLength(10);
    expect(plan.episodes.every((ep) => ep.targetDurationSeconds === 60)).toBe(true);
    expect(plan.estimatedClipCount).toBe(40); // 10 episodes × 4 clips of 15s
  });

  it('derives ~2 episodes from a 10-minute story with 5-minute episodes', () => {
    const plan = resolveSeriesDurationPlan({
      storyDurationSeconds: 600,
      episodeDurationSeconds: 300,
    });
    expect(plan.plannedEpisodeCount).toBe(2);
    expect(plan.episodes.map((ep) => ep.targetDurationSeconds)).toEqual([300, 300]);
  });

  it('fits 2 episodes into a 60s story even when episode default is still 60', () => {
    const plan = resolveSeriesDurationPlan({
      storyDurationSeconds: 60,
      plannedEpisodeCount: 2,
      episodeDurationSeconds: 60,
    });
    expect(plan.plannedEpisodeCount).toBe(2);
    expect(plan.episodeDurationSeconds).toBe(30);
    expect(plan.episodes.map((ep) => ep.targetDurationSeconds)).toEqual([30, 30]);
  });

  it('shortens the final episode to fit the complete story duration', () => {
    const plan = resolveSeriesDurationPlan({
      storyDurationSeconds: 150,
      episodeDurationSeconds: 60,
    });
    expect(plan.plannedEpisodeCount).toBe(3);
    expect(plan.episodes.map((ep) => ep.targetDurationSeconds)).toEqual([60, 60, 30]);
    expect(plan.episodes[2]?.truncatedToFitStory).toBe(true);
  });

  it('supports standalone movies without episodic splitting', () => {
    const plan = resolveSeriesDurationPlan({
      productionFormat: 'standalone',
      storyDurationSeconds: 600,
    });
    expect(plan.plannedEpisodeCount).toBe(1);
    expect(plan.episodes[0]?.targetDurationSeconds).toBe(600);
    expect(plan.episodeDurationSeconds).toBe(600);
    expect(plan.derivation).toBe('standalone_story');
  });

  it('never exceeds 15s per clip', () => {
    const clips = planClipDurationsForEpisode(60, 15);
    expect(clips).toHaveLength(4);
    expect(clips.every((clip) => clip.durationSeconds <= 15)).toBe(true);
    expect(clips.map((c) => c.durationSeconds)).toEqual([15, 15, 15, 15]);

    const uneven = planClipDurationsForEpisode(37, 15);
    expect(uneven.map((c) => c.durationSeconds)).toEqual([15, 15, 7]);
  });

  it('estimates Grok Lite cost from story video seconds', () => {
    const plan = resolveSeriesDurationPlan({
      storyDurationSeconds: 600,
      episodeDurationSeconds: 60,
    });
    expect(estimateGrokLiteCostFromDurationPlan(plan, 0.03)).toBeCloseTo(18, 5);
  });
});
