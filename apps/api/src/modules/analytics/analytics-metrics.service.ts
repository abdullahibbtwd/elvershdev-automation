import { Injectable } from '@nestjs/common';
import {
  averageOfAvailable,
  calculateCostPerEngagement,
  calculateCostPerThousandViews,
  calculateEngagementPerThousandViews,
  calculateEngagementRate,
  safeDivide,
  type EngagementParts,
} from '@ai-video/shared';

@Injectable()
export class AnalyticsMetricsService {
  engagementRate(input: EngagementParts) {
    return calculateEngagementRate(input);
  }

  engagementPerThousandViews(input: EngagementParts) {
    return calculateEngagementPerThousandViews(input);
  }

  completionRate(completed: number | null, started: number | null) {
    return safeDivide(
      completed,
      started,
      'Completion rate = completed plays / started plays. Both metrics must be available.',
    );
  }

  costPerThousandViews(costUsd: number | null, views: number | null) {
    return calculateCostPerThousandViews({ costUsd, views });
  }

  costPerEngagement(costUsd: number | null, engagement: number | null) {
    return calculateCostPerEngagement({ costUsd, engagement });
  }

  average(values: Array<number | null | undefined>) {
    return averageOfAvailable(values);
  }
}
