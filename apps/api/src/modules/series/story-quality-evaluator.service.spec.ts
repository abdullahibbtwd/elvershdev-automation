import { createMockStoryQualityScore } from '@ai-video/shared';
import { StoryQualityEvaluatorService } from './story-quality-evaluator.service';

describe('StoryQualityEvaluatorService.applyThreshold', () => {
  const service = Object.create(
    StoryQualityEvaluatorService.prototype,
  ) as StoryQualityEvaluatorService;

  it('accepts strong scores at default threshold', () => {
    const result = service.applyThreshold(createMockStoryQualityScore(true), 0.7);
    expect(result.accepted).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
    expect(result.note.toLowerCase()).toContain('do not predict');
  });

  it('rejects weak resolution even if overall looks ok', () => {
    const weak = createMockStoryQualityScore(true);
    weak.completeStoryResolution = 0.2;
    weak.overall = 0.9;
    const result = service.applyThreshold(weak, 0.7);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons.some((r) => r.includes('completeStoryResolution'))).toBe(
      true,
    );
  });

  it('rejects weak character depth or emotional engagement even if overall looks ok', () => {
    const weakDepth = createMockStoryQualityScore(true);
    weakDepth.characterDepth = 0.4;
    weakDepth.overall = 0.92;
    const depthResult = service.applyThreshold(weakDepth, 0.7);
    expect(depthResult.accepted).toBe(false);
    expect(depthResult.rejectionReasons.some((r) => r.includes('characterDepth'))).toBe(true);

    const weakEmotion = createMockStoryQualityScore(true);
    weakEmotion.emotionalEngagement = 0.3;
    weakEmotion.overall = 0.91;
    const emotionResult = service.applyThreshold(weakEmotion, 0.7);
    expect(emotionResult.accepted).toBe(false);
    expect(
      emotionResult.rejectionReasons.some((r) => r.includes('emotionalEngagement')),
    ).toBe(true);
  });
});
