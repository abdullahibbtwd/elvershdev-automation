import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsInsightConfidence, Prisma } from '@prisma/client';
import { ANALYTICS_NOTIFICATION_TYPES } from '@ai-video/shared';
import { GeminiProvider } from '../../integrations/providers/gemini.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateAnalyticsSettingsDto } from './dto/analytics.dto';

interface GeneratedInsight {
  recommendation: string;
  supportingMetrics: Record<string, unknown>;
  sampleSize: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedExperiment: string;
  category?: string;
  evidenceType: 'correlation_only' | 'observational';
}

@Injectable()
export class AnalyticsInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiProvider,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string) {
    return this.prisma.analyticsInsight.findMany({
      where: { userId, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async generate(userId: string) {
    const settings = await this.getSettings(userId);
    const from = new Date(Date.now() - settings.insightLookbackDays * 86_400_000);
    const summaries = await this.prisma.contentPerformanceSummary.findMany({
      where: { userId, dateTo: { gte: from }, sampleSize: { gte: settings.minSampleSizeForOptimization } },
      orderBy: { sampleSize: 'desc' },
      take: 30,
    });
    const sampleSize = summaries.reduce((sum, row) => sum + row.sampleSize, 0);
    if (sampleSize < settings.minSampleSizeForOptimization) {
      throw new BadRequestException(
        `Insufficient sample size: ${sampleSize}/${settings.minSampleSizeForOptimization}`,
      );
    }
    const schema = { parse: (input: unknown) => this.validateGenerated(input, settings.minSampleSizeForOptimization) };
    const prompt = [
      'Produce one conservative content-performance recommendation as JSON.',
      'Use observational/correlation language only. Never claim causation. Never change settings.',
      'Fields: recommendation, supportingMetrics, sampleSize, confidence (LOW|MEDIUM|HIGH),',
      'suggestedExperiment, optional category, evidenceType (correlation_only|observational).',
      `Minimum sample size: ${settings.minSampleSizeForOptimization}. Data: ${JSON.stringify(summaries)}`,
    ].join('\n');
    let insight: GeneratedInsight;
    if (this.gemini.shouldUseMock()) {
      const best = summaries[0]!;
      insight = {
        recommendation: `The observed results for ${best.dimensionValue} warrant a controlled follow-up test; this is correlation, not causation.`,
        supportingMetrics: { sampleSize: best.sampleSize, avgViews: best.avgViews },
        sampleSize: best.sampleSize,
        confidence: best.sampleSize >= settings.minSampleSizeForOptimization * 3 ? 'HIGH' : 'MEDIUM',
        suggestedExperiment: `Compare ${best.dimensionValue} with one baseline category while holding cadence and duration constant.`,
        category: best.dimensionValue,
        evidenceType: 'correlation_only',
      };
    } else {
      insight = (await this.gemini.generateJson('analytics_insight', prompt, schema)).data;
    }
    const saved = await this.prisma.analyticsInsight.create({
      data: {
        userId,
        recommendation: insight.recommendation,
        supportingMetrics: insight.supportingMetrics as Prisma.InputJsonValue,
        sampleSize: insight.sampleSize,
        confidence: insight.confidence as AnalyticsInsightConfidence,
        suggestedExperiment: insight.suggestedExperiment,
        category: insight.category,
        evidenceType: insight.evidenceType,
        dateFrom: from,
        dateTo: new Date(),
        metadata: { generatedBy: 'gemini', settingsChanged: false },
      },
    });
    await this.notifications.notify({
      userId,
      type: ANALYTICS_NOTIFICATION_TYPES.NEW_INSIGHTS,
      title: 'New analytics insight available',
      body: insight.recommendation,
      dedupeKey: `analytics:insight:${saved.id}`,
      metadata: { insightId: saved.id },
    });
    return saved;
  }

  getSettings(userId: string) {
    return this.prisma.analyticsOptimizationSettings.upsert({
      where: { userId }, create: { userId }, update: {},
    });
  }

  async updateSettings(userId: string, dto: UpdateAnalyticsSettingsDto) {
    const settings = await this.prisma.analyticsOptimizationSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    // Keep Phase 10 automation planner gate in sync — no second budget system.
    if (dto.performanceOptimizationEnabled !== undefined) {
      await this.prisma.automationConfig.upsert({
        where: { userId },
        create: { userId, performanceOptimizationEnabled: dto.performanceOptimizationEnabled },
        update: { performanceOptimizationEnabled: dto.performanceOptimizationEnabled },
      });
    }
    return settings;
  }

  private validateGenerated(input: unknown, minimum: number): GeneratedInsight {
    if (!input || typeof input !== 'object') throw new Error('Insight must be an object');
    const value = input as Record<string, unknown>;
    const recommendation = String(value.recommendation ?? '').trim();
    const suggestedExperiment = String(value.suggestedExperiment ?? '').trim();
    const sampleSize = Number(value.sampleSize);
    const confidence = String(value.confidence);
    const evidenceType = String(value.evidenceType);
    if (!recommendation || !suggestedExperiment || !Number.isInteger(sampleSize) || sampleSize < minimum) {
      throw new Error('Invalid or insufficiently supported insight');
    }
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(confidence)) throw new Error('Invalid confidence');
    if (!['correlation_only', 'observational'].includes(evidenceType)) throw new Error('Invalid evidence type');
    if (/\b(causes?|proves?|guarantees?|results? in)\b/i.test(recommendation)) {
      throw new Error('Causal claims are not allowed');
    }
    return {
      recommendation,
      suggestedExperiment,
      sampleSize,
      confidence: confidence as GeneratedInsight['confidence'],
      evidenceType: evidenceType as GeneratedInsight['evidenceType'],
      supportingMetrics:
        value.supportingMetrics && typeof value.supportingMetrics === 'object'
          ? value.supportingMetrics as Record<string, unknown>
          : {},
      category: typeof value.category === 'string' ? value.category : undefined,
    };
  }
}
