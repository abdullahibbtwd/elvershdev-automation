import {
  averageOfAvailable,
  availableMetric,
  calculateCostPerEngagement,
  calculateCostPerThousandViews,
  calculateEngagementPerThousandViews,
  calculateEngagementRate,
  safeDivide,
  unavailableMetric,
} from '@ai-video/shared';

describe('shared analytics calculations', () => {
  it('computes engagement rate only when all required parts are available', () => {
    expect(
      calculateEngagementRate({
        views: availableMetric(1000),
        likes: availableMetric(40),
        comments: availableMetric(10),
        shares: availableMetric(5),
      }).value,
    ).toBe(0.055);

    expect(
      calculateEngagementRate({
        views: availableMetric(0),
        likes: availableMetric(1),
        comments: availableMetric(1),
        shares: availableMetric(1),
      }).available,
    ).toBe(false);

    expect(
      calculateEngagementRate({
        views: unavailableMetric('not synced'),
        likes: availableMetric(1),
        comments: availableMetric(1),
        shares: availableMetric(1),
      }).value,
    ).toBeNull();
  });

  it('does not treat unavailable metrics as zero in cost ratios', () => {
    expect(calculateCostPerThousandViews({ costUsd: 10, views: unavailableMetric('n/a') }).value).toBeNull();
    expect(calculateCostPerThousandViews({ costUsd: 10, views: availableMetric(0) }).value).toBeNull();
    expect(calculateCostPerThousandViews({ costUsd: 10, views: availableMetric(5000) }).value).toBe(2);
    expect(calculateCostPerEngagement({ costUsd: 8, engagement: 0 }).available).toBe(false);
    expect(calculateCostPerEngagement({ costUsd: 8, engagement: 4 }).value).toBe(2);
  });

  it('averages only available values and refuses divide-by-zero', () => {
    expect(averageOfAvailable([10, null, 20, undefined]).value).toBe(15);
    expect(averageOfAvailable([null, undefined]).available).toBe(false);
    expect(safeDivide(10, 0, 'test').available).toBe(false);
    expect(safeDivide(10, 2, 'test').value).toBe(5);
    expect(
      calculateEngagementPerThousandViews({
        views: availableMetric(1000),
        likes: availableMetric(10),
        comments: availableMetric(5),
        shares: availableMetric(5),
      }).value,
    ).toBe(20);
  });
});
