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
});
