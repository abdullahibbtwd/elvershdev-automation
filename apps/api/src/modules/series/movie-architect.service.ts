import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  Prisma,
  SeriesApprovalStatus,
  SeriesEpisodeStatus,
  StorySeriesStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  SERIES_DEFAULTS,
  SERIES_NOTIFICATION_TYPES,
  buildEpisodeOutlinesPrompt,
  buildMovieArcPrompt,
  buildMovieCharactersPrompt,
  buildMoviePremisePrompt,
  createMockEpisodeOutlines,
  createMockMovieArc,
  createMockMovieCharacters,
  createMockMoviePremise,
  creativeSettingsToBriefFields,
  effectiveMovieApprovalRequired,
  episodeOutlinesBatchJsonSchema,
  episodeOutlinesBatchSchema,
  estimateGeminiCostUsd,
  getGeminiPricingFromEnv,
  mergeSeriesCreativeSettings,
  movieArchitectBriefSchema,
  movieArcPlanJsonSchema,
  movieArcPlanSchema,
  movieCharactersPlanJsonSchema,
  movieCharactersPlanSchema,
  moviePremiseJsonSchema,
  moviePremiseSchema,
  normalizeEpisodeOutlinesBatchInput,
  normalizeMovieArcPlanInput,
  normalizeMovieCharactersPlanInput,
  normalizeMoviePremiseInput,
  parseSeriesCreativeSettings,
  type CompleteMoviePlan,
  type EpisodeOutline,
  type MovieArchitectBrief,
  type SeriesStoryPlanningPayload,
} from '@ai-video/shared';
import { GeminiProvider, type GeminiUsage } from '../../integrations/providers/gemini.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CharacterDirectorService } from './character-director.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesLifecycleHandoffService } from './series-lifecycle-handoff.service';
import { StoryQualityEvaluatorService } from './story-quality-evaluator.service';
import type { GenerateSeriesDto } from './dto/generate-series.dto';

@Injectable()
export class MovieArchitectService {
  private readonly logger = new Logger(MovieArchitectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiProvider,
    private readonly quality: StoryQualityEvaluatorService,
    private readonly characters: CharacterDirectorService,
    private readonly configService: SeriesConfigService,
    private readonly lanes: SeriesLaneService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async generate(userId: string, dto: GenerateSeriesDto) {
    const config = await this.configService.getOrCreate(userId);
    if (!config.seriesStudioEnabled && dto.async) {
      // Allow manual generate for planning even when disabled? Spec says disabled must not schedule new jobs.
      // Manual generate is an explicit user action — allow inline; block only automatic async enqueue when disabled.
    }

    if (dto.async) {
      if (!this.configService.canScheduleNewWork(config) && !dto.useMockAi) {
        // Still allow explicit user-triggered async when studio enabled OR when forcing mock in tests
      }
      if (!config.seriesStudioEnabled) {
        throw new BadRequestException(
          'Enable Series Studio before enqueueing automatic movie planning jobs',
        );
      }
      const lane = await this.lanes.getOwned(userId, dto.laneId);
      const jobId = `series-plan-${userId}-${lane.id}-${Date.now()}`;
      const payload: SeriesStoryPlanningPayload = {
        userId,
        laneId: lane.id,
        mode: 'manual',
        useMockAi: dto.useMockAi,
        force: true,
      };
      await this.queues.getQueue(QUEUE_NAMES.SERIES_STORY_PLANNING).add(
        'plan_movie',
        { ...payload, request: dto },
        { jobId },
      );
      return {
        queued: true,
        jobId,
        laneId: lane.id,
      };
    }

    return this.planAndPersist(userId, dto);
  }

  /** Called by queue host or inline generate. */
  async planAndPersist(userId: string, dto: GenerateSeriesDto) {
    const lane = await this.lanes.getOwned(userId, dto.laneId);
    const config = await this.configService.getOrCreate(userId);

    // Precedence: system defaults < global creative < lane creative < request overrides
    const mergedCreative = mergeSeriesCreativeSettings(
      {
        language: config.language,
        tone: config.tone ?? undefined,
        visualStyle: config.visualDirection ?? undefined,
        episodesPerMovie: config.defaultPlannedEpisodeCount,
        episodeDurationSeconds: config.defaultEpisodeDurationSeconds,
      },
      parseSeriesCreativeSettings(config.creativeSettings),
      parseSeriesCreativeSettings(lane.creativeSettings),
      {
        genres: dto.genre ? [dto.genre, ...(dto.subgenres ?? [])] : undefined,
        themes: dto.theme ? [dto.theme] : undefined,
        targetAudience: dto.targetAudience,
        episodesPerMovie: dto.plannedEpisodeCount,
        episodeDurationSeconds: dto.targetEpisodeDurationSeconds,
        customCreativeInstructions: dto.additionalInstructions,
        storyConcept: dto.customPremise,
      },
    );
    const fromCreative = creativeSettingsToBriefFields(mergedCreative);
    const ideaMode =
      dto.ideaMode === 'custom' || Boolean(dto.customPremise?.trim())
        ? 'custom'
        : 'generate';

    const brief = movieArchitectBriefSchema.parse({
      genre: dto.genre ?? fromCreative.genre ?? 'Cinematic drama',
      subgenres: dto.subgenres?.length
        ? dto.subgenres
        : fromCreative.subgenres ?? [],
      theme: dto.theme ?? fromCreative.theme,
      targetAudience:
        dto.targetAudience ??
        fromCreative.targetAudience ??
        'Adult viewers who enjoy premium serialized drama',
      language: fromCreative.language ?? config.language,
      tone: fromCreative.tone ?? config.tone ?? SERIES_DEFAULTS.tone,
      visualDirection:
        fromCreative.visualDirection ??
        config.visualDirection ??
        SERIES_DEFAULTS.visualDirection,
      plannedEpisodeCount:
        dto.plannedEpisodeCount ??
        fromCreative.plannedEpisodeCount ??
        lane.plannedEpisodeCount ??
        config.defaultPlannedEpisodeCount,
      targetEpisodeDurationSeconds:
        dto.targetEpisodeDurationSeconds ??
        fromCreative.targetEpisodeDurationSeconds ??
        lane.targetEpisodeDurationSeconds ??
        config.defaultEpisodeDurationSeconds,
      additionalInstructions:
        [fromCreative.additionalInstructions, dto.additionalInstructions]
          .filter(Boolean)
          .join('\n') || undefined,
      customPremise: dto.customPremise?.trim() || undefined,
      ideaMode,
    });

    const draft = await this.prisma.storySeries.create({
      data: {
        userId,
        laneId: lane.id,
        title: 'Planning…',
        slug: await this.uniqueSlug(userId, `planning-${Date.now()}`),
        status: StorySeriesStatus.PLANNING,
        approvalStatus: SeriesApprovalStatus.PENDING,
        plannedEpisodeCount: brief.plannedEpisodeCount,
        targetEpisodeDurationSeconds: brief.targetEpisodeDurationSeconds,
        language: brief.language,
        tone: brief.tone,
        visualStyle: brief.visualDirection,
        isReplacementCandidate: dto.asReplacementCandidate === true,
        metadata: {
          brief,
          creativeSettingsSnapshot: mergedCreative,
          ideaMode,
        } as Prisma.InputJsonValue,
      },
    });

    try {
      const plan = await this.buildCompletePlan(brief, {
        useMockAi: dto.useMockAi,
        acceptanceThreshold: config.qualityAcceptanceThreshold,
        userId,
        seriesId: draft.id,
      });

      if (!plan.quality.accepted) {
        await this.prisma.storySeries.update({
          where: { id: draft.id },
          data: {
            status: StorySeriesStatus.FAILED,
            title: plan.premise.title,
            qualityScores: plan.quality as unknown as Prisma.InputJsonValue,
            metadata: {
              brief,
              creativeSettingsSnapshot: mergedCreative,
              ideaMode,
              rejectionReasons: plan.quality.rejectionReasons,
            } as Prisma.InputJsonValue,
          },
        });
        throw new BadRequestException({
          message: 'Movie plan rejected by quality evaluator',
          quality: plan.quality,
          seriesId: draft.id,
        });
      }

      const autoApproveMovie =
        !dto.asReplacementCandidate && !effectiveMovieApprovalRequired(config);

      const persisted = await this.persistPlan(userId, draft.id, lane.id, brief, plan, {
        asReplacementCandidate: dto.asReplacementCandidate === true,
        setAsActive:
          dto.asReplacementCandidate === true
            ? false
            : dto.setAsActive !== false,
        autoApproveMovie,
        creativeSettingsSnapshot: mergedCreative,
      });

      if (config.automaticCharacterGeneration) {
        try {
          await this.characters.generateReferencesForSeries(userId, persisted.id);
        } catch (error) {
          this.logger.warn(
            `Character reference generation failed for ${persisted.id}: ${(error as Error).message}`,
          );
        }
      }

      // Mirror manual approveSeries: kick next lifecycle stage when movie is auto-approved.
      if (autoApproveMovie && persisted.approvalStatus === SeriesApprovalStatus.APPROVED) {
        try {
          const handoff = this.moduleRef.get(SeriesLifecycleHandoffService, { strict: false });
          await handoff.afterMovieApproved(userId, persisted.id);
        } catch (error) {
          this.logger.warn(
            `Post-auto-approve movie handoff failed series=${persisted.id}: ${(error as Error).message}`,
          );
        }
      }

      await this.notifications.notify({
        userId,
        type: SERIES_NOTIFICATION_TYPES.MOVIE_PLANNED,
        title: autoApproveMovie ? 'Movie plan auto-approved' : 'Movie plan ready',
        body: autoApproveMovie
          ? `"${persisted.title}" (${brief.plannedEpisodeCount} episodes) was auto-approved and production may continue.`
          : `"${persisted.title}" (${brief.plannedEpisodeCount} episodes) is ready for review.`,
        dedupeKey: `series-movie-planned:${persisted.id}`,
        metadata: {
          seriesId: persisted.id,
          laneId: lane.id,
          autoApproved: autoApproveMovie,
        },
      });

      return this.getSeriesDetail(userId, persisted.id);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      await this.prisma.storySeries.update({
        where: { id: draft.id },
        data: {
          status: StorySeriesStatus.FAILED,
          metadata: {
            brief,
            creativeSettingsSnapshot: mergedCreative,
            ideaMode,
            error: error instanceof Error ? error.message : String(error),
          } as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
  }

  async buildCompletePlan(
    briefInput: MovieArchitectBrief,
    options: {
      useMockAi?: boolean;
      acceptanceThreshold: number;
      userId: string;
      seriesId?: string;
    },
  ): Promise<CompleteMoviePlan> {
    const brief = movieArchitectBriefSchema.parse(briefInput);
    const useMock = options.useMockAi === true || this.gemini.shouldUseMock();
    const usages: GeminiUsage[] = [];

    const premiseResult = await this.generatePremise(brief, useMock);
    usages.push(premiseResult.usage);

    const charactersResult = await this.generateCharacters(brief, premiseResult.data, useMock);
    usages.push(charactersResult.usage);

    const arcResult = await this.generateArc(
      brief,
      premiseResult.data,
      charactersResult.data.characters,
      useMock,
    );
    usages.push(arcResult.usage);

    if (!arcResult.data.ending?.trim()) {
      throw new BadRequestException('Movie arc must include a complete ending before episode production');
    }

    const outlines: EpisodeOutline[] = [];
    const batchSize = 5;
    for (let from = 1; from <= brief.plannedEpisodeCount; from += batchSize) {
      const to = Math.min(from + batchSize - 1, brief.plannedEpisodeCount);
      const batch = await this.generateEpisodeOutlines({
        brief,
        premise: premiseResult.data,
        arc: arcResult.data,
        characters: charactersResult.data.characters,
        fromEpisode: from,
        toEpisode: to,
        previousOutlinesSummary: outlines
          .map((e) => `Ep ${e.episodeNumber}: ${e.title} — ${e.keyPlotDevelopment}`)
          .join('\n'),
        useMock,
      });
      usages.push(batch.usage);
      outlines.push(...batch.data);
    }

    const byNumber = new Map(outlines.map((e) => [e.episodeNumber, e]));
    const normalizedOutlines: EpisodeOutline[] = [];
    for (let n = 1; n <= brief.plannedEpisodeCount; n++) {
      const outline = byNumber.get(n);
      if (!outline) {
        throw new BadRequestException(`Missing episode outline for episode ${n}`);
      }
      normalizedOutlines.push(outline);
    }

    const qualityResult = await this.quality.evaluate({
      brief,
      premise: premiseResult.data,
      arc: arcResult.data,
      episodeCount: normalizedOutlines.length,
      acceptanceThreshold: options.acceptanceThreshold,
      useMockAi: useMock,
    });
    usages.push(qualityResult.usage);

    await this.recordUsages(options.userId, usages, options.seriesId);

    return {
      premise: premiseResult.data,
      characters: charactersResult.data.characters,
      arc: arcResult.data,
      episodeOutlines: normalizedOutlines,
      quality: qualityResult.quality,
    };
  }

  private async generatePremise(brief: MovieArchitectBrief, useMock: boolean) {
    if (useMock) {
      const data = createMockMoviePremise(brief);
      return {
        data: moviePremiseSchema.parse(data),
        usage: this.mockUsage(150, 350),
      };
    }
    const prompt = buildMoviePremisePrompt(brief);
    return this.gemini.generateJson('series_movie_premise', prompt, moviePremiseSchema, {
      responseJsonSchema: moviePremiseJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeMoviePremiseInput,
    });
  }

  private async generateCharacters(
    brief: MovieArchitectBrief,
    premise: CompleteMoviePlan['premise'],
    useMock: boolean,
  ) {
    if (useMock) {
      return {
        data: movieCharactersPlanSchema.parse(createMockMovieCharacters(brief)),
        usage: this.mockUsage(200, 600),
      };
    }
    const prompt = buildMovieCharactersPrompt({ brief, premise });
    return this.gemini.generateJson(
      'series_movie_characters',
      prompt,
      movieCharactersPlanSchema,
      {
        responseJsonSchema: movieCharactersPlanJsonSchema as unknown as Record<string, unknown>,
        normalize: normalizeMovieCharactersPlanInput,
      },
    );
  }

  private async generateArc(
    brief: MovieArchitectBrief,
    premise: CompleteMoviePlan['premise'],
    characters: CompleteMoviePlan['characters'],
    useMock: boolean,
  ) {
    if (useMock) {
      return {
        data: movieArcPlanSchema.parse(createMockMovieArc(brief, premise)),
        usage: this.mockUsage(250, 700),
      };
    }
    const prompt = buildMovieArcPrompt({ brief, premise, characters });
    return this.gemini.generateJson('series_movie_arc', prompt, movieArcPlanSchema, {
      responseJsonSchema: movieArcPlanJsonSchema as unknown as Record<string, unknown>,
      normalize: normalizeMovieArcPlanInput,
    });
  }

  private async generateEpisodeOutlines(input: {
    brief: MovieArchitectBrief;
    premise: CompleteMoviePlan['premise'];
    arc: CompleteMoviePlan['arc'];
    characters: CompleteMoviePlan['characters'];
    fromEpisode: number;
    toEpisode: number;
    previousOutlinesSummary?: string;
    useMock: boolean;
  }) {
    if (input.useMock) {
      return {
        data: createMockEpisodeOutlines(input.brief, input.fromEpisode, input.toEpisode),
        usage: this.mockUsage(180, 500),
      };
    }
    const prompt = buildEpisodeOutlinesPrompt(input);
    const result = await this.gemini.generateJson(
      'series_episode_outlines',
      prompt,
      episodeOutlinesBatchSchema,
      {
        responseJsonSchema: episodeOutlinesBatchJsonSchema as unknown as Record<string, unknown>,
        normalize: normalizeEpisodeOutlinesBatchInput,
      },
    );
    return { data: result.data.episodes, usage: result.usage };
  }

  private async persistPlan(
    userId: string,
    seriesId: string,
    laneId: string,
    brief: MovieArchitectBrief,
    plan: CompleteMoviePlan,
    options: {
      asReplacementCandidate: boolean;
      setAsActive: boolean;
      autoApproveMovie?: boolean;
      creativeSettingsSnapshot?: Record<string, unknown>;
    },
  ) {
    const slug = await this.uniqueSlug(userId, plan.premise.title);
    const approved = options.autoApproveMovie === true && !options.asReplacementCandidate;

    return this.prisma.$transaction(async (tx) => {
      const series = await tx.storySeries.update({
        where: { id: seriesId },
        data: {
          title: plan.premise.title,
          slug,
          logline: plan.premise.logline,
          synopsis: plan.premise.synopsis,
          genre: plan.premise.genre,
          subgenres: plan.premise.subgenres,
          targetAudience: plan.premise.targetAudience,
          visualStyle: plan.premise.visualStyle,
          language: brief.language,
          tone: brief.tone,
          plannedEpisodeCount: brief.plannedEpisodeCount,
          targetEpisodeDurationSeconds: brief.targetEpisodeDurationSeconds,
          status: options.asReplacementCandidate
            ? StorySeriesStatus.REPLACEMENT_CANDIDATE
            : StorySeriesStatus.READY,
          approvalStatus: approved
            ? SeriesApprovalStatus.APPROVED
            : SeriesApprovalStatus.PENDING,
          approvedAt: approved ? new Date() : null,
          qualityScores: plan.quality as unknown as Prisma.InputJsonValue,
          isReplacementCandidate: options.asReplacementCandidate,
          metadata: {
            brief,
            creativeSettingsSnapshot: options.creativeSettingsSnapshot ?? brief,
            knowledgeMap: plan.arc.knowledgeMap,
            productionSeparatedFromPlanning: true,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.seriesBible.upsert({
        where: { seriesId },
        create: {
          seriesId,
          version: 1,
          premise: plan.arc.premise,
          worldRules: plan.premise.worldRules,
          setting: plan.premise.setting,
          masterPlot: plan.arc.masterPlot,
          beginning: plan.arc.beginning,
          middle: plan.arc.middle,
          climax: plan.arc.climax,
          resolution: plan.arc.resolution,
          majorConflicts: plan.arc.majorConflicts,
          secrets: plan.arc.secrets as unknown as Prisma.InputJsonValue,
          reveals: plan.arc.reveals as unknown as Prisma.InputJsonValue,
          ending: plan.arc.ending,
          canonicalOutline: {
            logline: plan.premise.logline,
            synopsis: plan.premise.synopsis,
            mainConflict: plan.premise.mainConflict,
          },
          episodeOutlines: plan.episodeOutlines as unknown as Prisma.InputJsonValue,
          foreshadowingMap: plan.arc.foreshadowingMap as unknown as Prisma.InputJsonValue,
          cliffhangerPayoffMap: plan.arc.reveals as unknown as Prisma.InputJsonValue,
          characterArcs: plan.arc.characterArcs as unknown as Prisma.InputJsonValue,
          knowledgeMap: plan.arc.knowledgeMap as unknown as Prisma.InputJsonValue,
          approvedAt: approved ? new Date() : null,
        },
        update: {
          version: { increment: 1 },
          premise: plan.arc.premise,
          worldRules: plan.premise.worldRules,
          setting: plan.premise.setting,
          masterPlot: plan.arc.masterPlot,
          beginning: plan.arc.beginning,
          middle: plan.arc.middle,
          climax: plan.arc.climax,
          resolution: plan.arc.resolution,
          majorConflicts: plan.arc.majorConflicts,
          secrets: plan.arc.secrets as unknown as Prisma.InputJsonValue,
          reveals: plan.arc.reveals as unknown as Prisma.InputJsonValue,
          ending: plan.arc.ending,
          episodeOutlines: plan.episodeOutlines as unknown as Prisma.InputJsonValue,
          foreshadowingMap: plan.arc.foreshadowingMap as unknown as Prisma.InputJsonValue,
          cliffhangerPayoffMap: plan.arc.reveals as unknown as Prisma.InputJsonValue,
          characterArcs: plan.arc.characterArcs as unknown as Prisma.InputJsonValue,
          knowledgeMap: plan.arc.knowledgeMap as unknown as Prisma.InputJsonValue,
          ...(approved ? { approvedAt: new Date() } : {}),
        },
      });

      await this.characters.persistCharacters(seriesId, plan.characters, tx);

      await tx.seriesEpisode.deleteMany({ where: { seriesId } });
      for (const outline of plan.episodeOutlines) {
        await tx.seriesEpisode.create({
          data: {
            seriesId,
            episodeNumber: outline.episodeNumber,
            title: outline.title,
            synopsis: outline.synopsis,
            hook: outline.hook,
            ending: outline.cliffhangerOrEnding,
            cliffhanger: outline.cliffhangerOrEnding,
            nextEpisodeSetup: outline.nextEpisodeSetup,
            targetDurationSeconds: brief.targetEpisodeDurationSeconds,
            status: SeriesEpisodeStatus.PLANNED,
            metadata: {
              keyPlotDevelopment: outline.keyPlotDevelopment,
              emotionalBeat: outline.emotionalBeat,
              charactersFeatured: outline.charactersFeatured,
              reveals: outline.reveals,
              continuityNotes: outline.continuityNotes,
            },
          },
        });
      }

      if (options.setAsActive) {
        await tx.seriesLane.update({
          where: { id: laneId },
          data: { activeSeriesId: seriesId },
        });
        await tx.storySeries.update({
          where: { id: seriesId },
          data: {
            status: StorySeriesStatus.ACTIVE,
            activatedAt: new Date(),
          },
        });
      }

      await tx.seriesAuditLog.create({
        data: {
          userId,
          action: 'series.movie.planned',
          entityType: 'StorySeries',
          entityId: seriesId,
          after: {
            title: series.title,
            episodeCount: plan.episodeOutlines.length,
            qualityOverall: plan.quality.overall,
          },
        },
      });

      return series;
    });
  }

  async getSeriesDetail(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      include: {
        bible: true,
        characters: {
          include: {
            referenceAssets: {
              where: { isPrimary: true },
              take: 1,
              include: { mediaAsset: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        episodes: { orderBy: { episodeNumber: 'asc' } },
        lane: { select: { id: true, laneType: true, status: true } },
      },
    });
    if (!series) throw new NotFoundException('Series not found');
    return series;
  }

  private async uniqueSlug(userId: string, title: string): Promise<string> {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'series';
    let slug = base;
    let i = 1;
    while (
      await this.prisma.storySeries.findFirst({ where: { userId, slug }, select: { id: true } })
    ) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  private mockUsage(inputTokens: number, outputTokens: number): GeminiUsage {
    return {
      model: 'mock-gemini',
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateGeminiCostUsd(
        inputTokens,
        outputTokens,
        getGeminiPricingFromEnv(),
      ),
    };
  }

  private async recordUsages(userId: string, usages: GeminiUsage[], seriesId?: string) {
    for (const usage of usages) {
      await this.prisma.providerUsage.create({
        data: {
          userId,
          provider: 'gemini',
          model: usage.model,
          requestType: 'series_movie_architect',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCost: usage.estimatedCostUsd,
          metadata: seriesId ? { seriesId } : {},
        },
      });
    }
  }
}
