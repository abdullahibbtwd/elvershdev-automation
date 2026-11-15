import {
  createMockScenePlan,
  createMockStoryResult,
  estimateGeminiCostUsd,
  generatedScenePlanSchema,
  generatedStorySchema,
  storyBriefSchema,
} from '@ai-video/shared';

describe('story-ai shared contracts', () => {
  const brief = storyBriefSchema.parse({
    topic: 'A quiet decision that changed everything',
    niche: 'Business',
    targetAudience: 'Founders',
    language: 'en',
    tone: 'Cinematic',
    desiredDurationSeconds: 45,
    category: 'Narrative',
  });

  it('validates generated story mock output', () => {
    const story = createMockStoryResult(brief);
    expect(() => generatedStorySchema.parse(story)).not.toThrow();
  });

  it('validates scene plan mock output and duration', () => {
    const story = createMockStoryResult(brief);
    const plan = createMockScenePlan(brief, story);
    expect(() => generatedScenePlanSchema.parse(plan)).not.toThrow();
    const total = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    expect(total).toBeCloseTo(brief.desiredDurationSeconds, 1);
  });

  it('rejects incomplete story payloads', () => {
    expect(() =>
      generatedStorySchema.parse({
        title: 'x',
        story: '',
        openingHook: 'hook',
        narrationScript: 'script',
        closingMessage: 'bye',
        description: 'desc',
        hashtags: [],
      }),
    ).toThrow();
  });

  it('estimates cost from configurable pricing', () => {
    const cost = estimateGeminiCostUsd(1_000_000, 1_000_000, {
      inputPerMillionUsd: 0.1,
      outputPerMillionUsd: 0.4,
    });
    expect(cost).toBe(0.5);
  });
});
