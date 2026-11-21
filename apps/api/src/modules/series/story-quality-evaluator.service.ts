import { Injectable, Logger } from '@nestjs/common';
import {
  buildStoryQualityPrompt,
  createMockStoryQualityScore,
  estimateGeminiCostUsd,
  getGeminiPricingFromEnv,
  movieArchitectBriefSchema,
  normalizeStoryQualityScoreInput,
  storyQualityScoreJsonSchema,
  storyQualityScoreSchema,
  type MovieArchitectBrief,
  type MovieArcPlan,
  type MoviePremise,
  type StoryQualityScore,
} from '@ai-video/shared';
import { GeminiProvider, type GeminiUsage } from '../../integrations/providers/gemini.provider';

@Injectable()
export class StoryQualityEvaluatorService {
  private readonly logger = new Logger(StoryQualityEvaluatorService.name);

  constructor(private readonly gemini: GeminiProvider) {}

  async evaluate(input: {
    brief: MovieArchitectBrief;
    premise: MoviePremise;
    arc: MovieArcPlan;
    episodeCount: number;
    acceptanceThreshold: number;
    useMockAi?: boolean;
  }): Promise<{ quality: StoryQualityScore; usage: GeminiUsage }> {
    const brief = movieArchitectBriefSchema.parse(input.brief);
    const threshold = input.acceptanceThreshold;

    if (input.useMockAi || this.gemini.shouldUseMock()) {
      const quality = this.applyThreshold(createMockStoryQualityScore(true), threshold);
      return {
        quality,
        usage: {
          model: 'mock-gemini',
          inputTokens: 180,
          outputTokens: 220,
          estimatedCostUsd: estimateGeminiCostUsd(180, 220, getGeminiPricingFromEnv()),
        },
      };
    }

    const prompt = buildStoryQualityPrompt({
      brief,
      premise: input.premise,
      arc: input.arc,
      episodeCount: input.episodeCount,
      acceptanceThreshold: threshold,
    });

    const result = await this.gemini.generateJson(
      'series_quality_evaluation',
      prompt,
      storyQualityScoreSchema,
      {
        responseJsonSchema: storyQualityScoreJsonSchema as unknown as Record<string, unknown>,
        normalize: normalizeStoryQualityScoreInput,
      },
    );

    const quality = this.applyThreshold(result.data, threshold);
    this.logger.log(
      `Series quality overall=${quality.overall} accepted=${quality.accepted} threshold=${threshold}`,
    );
    return { quality, usage: result.usage };
  }

  /** Deterministic gate used after model (or mock) scoring. */
  applyThreshold(score: StoryQualityScore, threshold: number): StoryQualityScore {
    const rejectionReasons = [...score.rejectionReasons];
    const gates: Array<{ key: keyof StoryQualityScore; label: string; value: number }> = [
      { key: 'overall', label: 'overall', value: score.overall },
      { key: 'plotCoherence', label: 'plotCoherence', value: score.plotCoherence },
      {
        key: 'completeStoryResolution',
        label: 'completeStoryResolution',
        value: score.completeStoryResolution,
      },
      { key: 'characterDepth', label: 'characterDepth', value: score.characterDepth },
      {
        key: 'emotionalEngagement',
        label: 'emotionalEngagement',
        value: score.emotionalEngagement,
      },
    ];

    for (const gate of gates) {
      if (gate.value < threshold) {
        rejectionReasons.push(
          `${gate.label} ${gate.value} < threshold ${threshold} — revise before accepting`,
        );
      }
    }

    const accepted = gates.every((gate) => gate.value >= threshold);

    return {
      ...score,
      accepted,
      rejectionReasons: accepted ? [] : [...new Set(rejectionReasons)],
      note:
        score.note ||
        'Scores measure story craft only. They do not predict audience reach or viral performance.',
    };
  }
}
