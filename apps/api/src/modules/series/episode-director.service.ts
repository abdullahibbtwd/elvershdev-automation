import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesEpisodeApprovalStatus,
  SeriesEpisodeStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  SERIES_DEFAULTS,
  SERIES_NOTIFICATION_TYPES,
  SERIES_DIALOGUE_CREATIVE_DEFAULTS,
  buildCreativeLanguageStyleNotes,
  buildDialogueEpisodeScriptPrompt,
  buildEpisodeScriptPrompt,
  countSpokenWords,
  createMockDialogueEpisodeScript,
  createMockEpisodeScript,
  dialogueEpisodeScriptPlanJsonSchema,
  dialogueEpisodeScriptPlanSchema,
  dialoguePlanToEpisodeScriptPlan,
  effectiveEpisodeApprovalRequired,
  episodeScriptPlanJsonSchema,
  episodeScriptPlanSchema,
  estimateGeminiCostUsd,
  getGeminiPricingFromEnv,
  isDialogueDrivenCreative,
  mergeSeriesCreativeSettings,
  normalizeDialogueEpisodeScriptPlanInput,
  normalizeEpisodeScriptPlanInput,
  parseSeriesCreativeSettings,
  type DialogueEpisodeScriptPlan,
  type EpisodeScriptPlan,
  type SeriesCreativeSettings,
  type SeriesEpisodePlanningPayload,
} from '@ai-video/shared';
import { GeminiProvider } from '../../integrations/providers/gemini.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClipPlanningService } from './clip-planning.service';
import { ContinuityEngineService } from './continuity-engine.service';
import { DialogueProductionService } from './dialogue-production.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesLifecycleHandoffService } from './series-lifecycle-handoff.service';

@Injectable()
export class EpisodeDirectorService {
  private readonly logger = new Logger(EpisodeDirectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiProvider,
    private readonly continuity: ContinuityEngineService,
    private readonly configService: SeriesConfigService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
    private readonly handoff: SeriesLifecycleHandoffService,
    private readonly dialogueProduction: DialogueProductionService,
    private readonly clipPlanning: ClipPlanningService,
  ) {}

  async getEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      include: {
        scenes: { orderBy: { sceneOrder: 'asc' } },
        shots: {
          orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }],
          include: {
            dialogueLine: {
              select: {
                id: true,
                text: true,
                speakerName: true,
                emotion: true,
                durationSeconds: true,
              },
            },
          },
        },
        videoClips: { orderBy: { clipIndex: 'asc' } },
        continuitySnapshots: true,
        memoryEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }

  async generateEpisode(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: { useMockAi?: boolean; async?: boolean; regenerate?: boolean },
  ) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    if (
      episode.approvalStatus === SeriesEpisodeApprovalStatus.APPROVED &&
      !options?.regenerate
    ) {
      throw new BadRequestException(
        'Episode is approved. Use regenerate to create a new draft (does not overwrite canon silently until re-approved).',
      );
    }

    if (options?.async) {
      const config = await this.configService.getOrCreate(userId);
      if (!config.seriesStudioEnabled) {
        throw new BadRequestException('Enable Series Studio before enqueueing episode planning');
      }
      const payload: SeriesEpisodePlanningPayload = {
        userId,
        seriesId,
        episodeId,
        useMockAi: options.useMockAi,
        force: options.regenerate === true,
      };
      const jobId = `series-ep-plan-${episodeId}-${Date.now()}`;
      await this.queues.getQueue(QUEUE_NAMES.SERIES_EPISODE_PLANNING).add(
        'plan_episode',
        payload,
        { jobId },
      );
      return { queued: true, jobId, episodeId };
    }

    return this.planAndPersist(userId, seriesId, episodeId, {
      useMockAi: options?.useMockAi,
      regenerate: options?.regenerate,
    });
  }

  async planAndPersist(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: { useMockAi?: boolean; regenerate?: boolean },
  ) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      include: { bible: true },
    });
    if (!series) throw new NotFoundException('Series not found');
    if (!series.bible?.ending?.trim()) {
      throw new BadRequestException(
        'Full movie ending must exist in the bible before episode production',
      );
    }

    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        status: SeriesEpisodeStatus.SCRIPTING,
        lastError: null,
      },
    });

    try {
      const context = await this.continuity.buildCompactContext(
        seriesId,
        episode.episodeNumber,
      );
      const meta = (episode.metadata ?? {}) as Record<string, unknown>;
      const config = await this.configService.getOrCreate(userId);
      const lane = series.laneId
        ? await this.prisma.seriesLane.findFirst({
            where: { id: series.laneId, userId, deletedAt: null },
            select: { creativeSettings: true },
          })
        : null;
      const creative = this.resolveCreativeSettings(series, config, lane?.creativeSettings);
      const dialogueDriven = isDialogueDrivenCreative(creative);
      const languageStyleNotes = this.buildLanguageStyleNotes(
        series,
        config,
        lane?.creativeSettings,
      );

      const planInput = {
        seriesTitle: series.title,
        plannedEpisodeCount: series.plannedEpisodeCount,
        targetDurationSeconds:
          episode.targetDurationSeconds || SERIES_DEFAULTS.targetEpisodeDurationSeconds,
        episodeNumber: episode.episodeNumber,
        outlineTitle: episode.title,
        outlineSynopsis: episode.synopsis,
        outlineHook: episode.hook,
        outlineKeyPlot:
          typeof meta.keyPlotDevelopment === 'string' ? meta.keyPlotDevelopment : null,
        outlineCliffhanger: episode.cliffhanger,
        outlineNextSetup: episode.nextEpisodeSetup,
        context,
        useMockAi: options?.useMockAi,
        userId,
        seriesId,
        episodeId,
        languageStyleNotes,
        creative,
        dialogueDriven,
      };

      let dialoguePlan: DialogueEpisodeScriptPlan | null = null;
      let plan: EpisodeScriptPlan;
      if (dialogueDriven) {
        dialoguePlan = await this.generateDialogueScriptPlan(planInput);
        plan = dialoguePlanToEpisodeScriptPlan(dialoguePlan);
      } else {
        plan = await this.generateScriptPlan(planInput);
      }

      let validation = await this.continuity.validateEpisode({
        userId,
        seriesId,
        episodeId,
        stage: 'pre_script_approval',
        plan,
        useMockAi: options?.useMockAi,
      });

      // One automatic rewrite with continuity feedback before failing the episode.
      if (!validation.valid) {
        const revisionNotes = validation.issues
          .map((i) => `- [${i.severity}] ${i.code}: ${i.message}${i.suggestedFix ? ` Fix: ${i.suggestedFix}` : ''}`)
          .join('\n');
        this.logger.warn(
          `Episode ${episode.episodeNumber} continuity failed (${validation.issues.length} issues) — retrying once`,
        );
        if (dialogueDriven) {
          dialoguePlan = await this.generateDialogueScriptPlan({
            ...planInput,
            revisionNotes,
          });
          plan = dialoguePlanToEpisodeScriptPlan(dialoguePlan);
        } else {
          plan = await this.generateScriptPlan({ ...planInput, revisionNotes });
        }
        validation = await this.continuity.validateEpisode({
          userId,
          seriesId,
          episodeId,
          stage: 'pre_script_approval',
          plan,
          useMockAi: options?.useMockAi,
        });
      }

      if (!validation.valid) {
        await this.prisma.seriesEpisode.update({
          where: { id: episodeId },
          data: {
            status: SeriesEpisodeStatus.FAILED,
            lastError: validation.summary,
            metadata: {
              ...meta,
              continuityValidation: validation,
            },
          },
        });
        throw new BadRequestException({
          message: 'Episode failed continuity validation',
          validation,
          episodeId,
        });
      }

      const autoApprove = !effectiveEpisodeApprovalRequired(config);

      const saved = await this.prisma.$transaction(async (tx) => {
        await tx.episodeScene.deleteMany({ where: { episodeId } });
        for (const scene of plan.scenes) {
          await tx.episodeScene.create({
            data: {
              episodeId,
              sceneOrder: scene.sceneOrder,
              location: scene.location,
              characters: scene.characters as Prisma.InputJsonValue,
              action: scene.action,
              visualDescription: scene.visualDescription,
              dialogue: scene.dialogue,
              narration: scene.narration,
              emotionalDirection: scene.emotionalDirection,
              shotDirection: scene.shotDirection,
              metadata: dialoguePlan
                ? ({
                    dialogueDriven: true,
                    shots:
                      dialoguePlan.scenes.find((s) => s.sceneNumber === scene.sceneOrder)
                        ?.shots ?? [],
                  } as Prisma.InputJsonValue)
                : undefined,
            },
          });
        }

        return tx.seriesEpisode.update({
          where: { id: episodeId },
          data: {
            title: plan.title,
            synopsis: plan.synopsis,
            hook: plan.hook,
            script: plan.script,
            narrationText: dialogueDriven ? plan.narrationText || '' : plan.narrationText,
            ending: plan.ending,
            cliffhanger: plan.cliffhanger || plan.ending,
            nextEpisodeSetup: plan.nextEpisodeSetup,
            spokenWordCount:
              plan.spokenWordCount ||
              countSpokenWords(plan.script || plan.narrationText),
            status: autoApprove
              ? SeriesEpisodeStatus.APPROVED
              : SeriesEpisodeStatus.SCRIPT_READY,
            approvalStatus: autoApprove
              ? SeriesEpisodeApprovalStatus.APPROVED
              : SeriesEpisodeApprovalStatus.PENDING,
            approvedAt: autoApprove ? new Date() : null,
            continuityChanges: plan.continuityChanges as unknown as Prisma.InputJsonValue,
            metadata: {
              ...meta,
              keyPlotDevelopment: plan.keyPlotDevelopment,
              emotionalBeats: plan.emotionalBeats,
              continuityValidation: validation,
              regenerated: options?.regenerate === true,
              dialogueDriven,
              dialoguePlan: dialoguePlan ?? undefined,
            },
            lastError: null,
          },
          include: {
            scenes: { orderBy: { sceneOrder: 'asc' } },
          },
        });
      });

      if (dialoguePlan) {
        await this.dialogueProduction.materializeDialoguePlan(
          userId,
          episodeId,
          dialoguePlan,
          { force: true },
        );
      }

      await this.continuity.persistAfterEpisode({
        seriesId,
        episodeId,
        episodeNumber: episode.episodeNumber,
        plan,
        characterNameToId: context.characterNameToId,
        beforeState: context.snapshotState,
      });

      this.logger.log(
        `Episode script ready series=${seriesId} episode=${episode.episodeNumber} words=${saved.spokenWordCount}`,
      );

      await this.prisma.storySeries.update({
        where: { id: seriesId },
        data: { currentEpisodeNumber: Math.max(series.currentEpisodeNumber, episode.episodeNumber) },
      });

      await this.prisma.seriesAuditLog.create({
        data: {
          userId,
          action: options?.regenerate ? 'series.episode.regenerated' : 'series.episode.generated',
          entityType: 'SeriesEpisode',
          entityId: episodeId,
          after: {
            episodeNumber: episode.episodeNumber,
            status: saved.status,
            spokenWordCount: saved.spokenWordCount,
          },
        },
      });

      if (!autoApprove) {
        await this.notifications.notify({
          userId,
          type: SERIES_NOTIFICATION_TYPES.EPISODE_NEEDS_APPROVAL,
          title: `Episode ${episode.episodeNumber} needs approval`,
          body: `"${saved.title}" script is ready for review.`,
          dedupeKey: `series-ep-approve:${episodeId}:${saved.updatedAt.toISOString()}`,
          metadata: { seriesId, episodeId },
        });
      } else {
        try {
          await this.handoff.afterEpisodeApproved(userId, seriesId, episodeId);
        } catch (error) {
          this.logger.warn(
            `Auto-approve production handoff failed episode=${episodeId}: ${(error as Error).message}`,
          );
        }
      }

      return this.getEpisode(userId, seriesId, episodeId);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      await this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          status: SeriesEpisodeStatus.FAILED,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async approveEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    if (!episode.script) {
      throw new BadRequestException('Cannot approve an episode without a script');
    }

    const validation = await this.continuity.validateEpisode({
      userId,
      seriesId,
      episodeId,
      stage: 'pre_script_approval',
      // Trust generation-time pass when local checks still pass — avoid empty-plan Gemini false fails.
      preferStoredValidation: true,
    });
    if (!validation.valid) {
      await this.prisma.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          blockedReason: 'continuity_validation_failed',
          metadata: {
            ...((episode.metadata as Record<string, unknown> | null) ?? {}),
            continuityValidation: validation,
          } as Prisma.InputJsonValue,
        },
      });
      throw new BadRequestException({
        message: 'Episode failed continuity validation before approval',
        validation,
      });
    }

    const updated = await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        approvalStatus: SeriesEpisodeApprovalStatus.APPROVED,
        status: SeriesEpisodeStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    await this.prisma.seriesAuditLog.create({
      data: {
        userId,
        action: 'series.episode.approve',
        entityType: 'SeriesEpisode',
        entityId: episodeId,
        after: { approvalStatus: updated.approvalStatus },
      },
    });

    try {
      await this.handoff.afterEpisodeApproved(userId, seriesId, episodeId);
    } catch (error) {
      this.logger.warn(
        `Post-episode-approval handoff failed episode=${episodeId}: ${(error as Error).message}`,
      );
    }

    // Phase 3: build Grok Lite ≤15s clip plan from screenplay shots after approval.
    try {
      await this.clipPlanning.planClips(userId, seriesId, episodeId, { force: true });
    } catch (error) {
      this.logger.warn(
        `Clip plan after approval failed episode=${episodeId}: ${(error as Error).message}`,
      );
    }

    return this.getEpisode(userId, seriesId, episodeId);
  }

  async validateForVisuals(userId: string, seriesId: string, episodeId: string, useMockAi?: boolean) {
    const episode = await this.requireEpisode(userId, seriesId, episodeId);
    if (episode.approvalStatus !== SeriesEpisodeApprovalStatus.APPROVED) {
      throw new BadRequestException('Episode must be approved before pre-visual continuity validation');
    }
    return this.continuity.validateEpisode({
      userId,
      seriesId,
      episodeId,
      stage: 'pre_visual',
      useMockAi,
    });
  }

  private resolveCreativeSettings(
    series: { metadata?: unknown },
    config: { creativeSettings?: unknown },
    laneCreativeSettings?: unknown,
  ): SeriesCreativeSettings {
    const seriesMeta = (series.metadata ?? {}) as Record<string, unknown>;
    // Dialogue-first product defaults < global < plan snapshot < current lane
    // (lane last so enabling Dialogue-driven after Plan Movie fixes script regen).
    return mergeSeriesCreativeSettings(
      SERIES_DIALOGUE_CREATIVE_DEFAULTS,
      parseSeriesCreativeSettings(config.creativeSettings),
      parseSeriesCreativeSettings(seriesMeta.creativeSettingsSnapshot),
      parseSeriesCreativeSettings(laneCreativeSettings),
    );
  }

  private buildLanguageStyleNotes(
    series: {
      metadata?: unknown;
      language?: string | null;
      tone?: string | null;
    },
    config: { creativeSettings?: unknown },
    laneCreativeSettings?: unknown,
  ): string | undefined {
    const snapshot = this.resolveCreativeSettings(series, config, laneCreativeSettings);
    const fromCreative = buildCreativeLanguageStyleNotes(snapshot);
    const extras = [
      series.language ? `Series language: ${series.language}` : null,
      series.tone ? `Series tone: ${series.tone}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const combined = [fromCreative, extras].filter(Boolean).join('\n').trim();
    return combined || undefined;
  }

  private async generateDialogueScriptPlan(input: {
    seriesTitle: string;
    plannedEpisodeCount: number;
    targetDurationSeconds: number;
    episodeNumber: number;
    outlineTitle: string;
    outlineSynopsis: string | null;
    outlineHook: string | null;
    outlineKeyPlot: string | null;
    outlineCliffhanger: string | null;
    outlineNextSetup: string | null;
    context: Awaited<ReturnType<ContinuityEngineService['buildCompactContext']>>;
    useMockAi?: boolean;
    userId: string;
    seriesId: string;
    episodeId: string;
    revisionNotes?: string;
    languageStyleNotes?: string;
    creative: SeriesCreativeSettings;
  }): Promise<DialogueEpisodeScriptPlan> {
    const useMock = input.useMockAi === true || this.gemini.shouldUseMock();
    if (useMock) {
      const data = dialogueEpisodeScriptPlanSchema.parse(
        createMockDialogueEpisodeScript({
          episodeNumber: input.episodeNumber,
          title: input.outlineTitle,
          targetDurationSeconds: input.targetDurationSeconds,
        }),
      );
      await this.prisma.providerUsage.create({
        data: {
          userId: input.userId,
          provider: 'gemini',
          model: 'mock-gemini',
          requestType: 'series_dialogue_episode_director',
          inputTokens: 220,
          outputTokens: 700,
          estimatedCost: estimateGeminiCostUsd(220, 700, getGeminiPricingFromEnv()),
          metadata: { seriesId: input.seriesId, episodeId: input.episodeId },
        },
      });
      return data;
    }

    const prompt = buildDialogueEpisodeScriptPrompt({
      seriesTitle: input.seriesTitle,
      episodeNumber: input.episodeNumber,
      plannedEpisodeCount: input.plannedEpisodeCount,
      targetDurationSeconds: input.targetDurationSeconds,
      outlineTitle: input.outlineTitle,
      outlineSynopsis: input.outlineSynopsis ?? '',
      outlineHook: input.outlineHook,
      outlineKeyPlot: input.outlineKeyPlot,
      outlineCliffhanger: input.outlineCliffhanger,
      outlineNextSetup: input.outlineNextSetup,
      bibleDigest: input.context.bibleDigest,
      characterDigest: input.context.characterDigest,
      previousEpisodeSummary: input.context.previousEpisodeSummary,
      continuityDigest: input.context.continuityDigest,
      memoryDigest: input.context.memoryDigest,
      unresolvedMysteries: input.context.unresolvedMysteries,
      relationshipsDigest: input.context.relationshipsDigest,
      visualRefsDigest: input.context.visualRefsDigest,
      revisionNotes: input.revisionNotes,
      languageStyleNotes: input.languageStyleNotes,
      creative: input.creative,
    });

    const result = await this.gemini.generateJson(
      'series_dialogue_episode_director',
      prompt,
      dialogueEpisodeScriptPlanSchema,
      {
        responseJsonSchema: dialogueEpisodeScriptPlanJsonSchema as unknown as Record<
          string,
          unknown
        >,
        normalize: normalizeDialogueEpisodeScriptPlanInput,
      },
    );

    await this.prisma.providerUsage.create({
      data: {
        userId: input.userId,
        provider: 'gemini',
        model: result.usage.model,
        requestType: 'series_dialogue_episode_director',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCost: result.usage.estimatedCostUsd,
        metadata: { seriesId: input.seriesId, episodeId: input.episodeId },
      },
    });

    return {
      ...result.data,
      episodeNumber: input.episodeNumber,
      spokenWordCount:
        result.data.spokenWordCount || countSpokenWords(result.data.script),
    };
  }

  private async generateScriptPlan(input: {
    seriesTitle: string;
    plannedEpisodeCount: number;
    targetDurationSeconds: number;
    episodeNumber: number;
    outlineTitle: string;
    outlineSynopsis: string | null;
    outlineHook: string | null;
    outlineKeyPlot: string | null;
    outlineCliffhanger: string | null;
    outlineNextSetup: string | null;
    context: Awaited<ReturnType<ContinuityEngineService['buildCompactContext']>>;
    useMockAi?: boolean;
    userId: string;
    seriesId: string;
    episodeId: string;
    revisionNotes?: string;
    languageStyleNotes?: string;
  }): Promise<EpisodeScriptPlan> {
    const useMock = input.useMockAi === true || this.gemini.shouldUseMock();
    if (useMock) {
      const data = episodeScriptPlanSchema.parse(
        createMockEpisodeScript({
          episodeNumber: input.episodeNumber,
          title: input.outlineTitle,
          synopsis: input.outlineSynopsis,
          targetDurationSeconds: input.targetDurationSeconds,
        }),
      );
      await this.prisma.providerUsage.create({
        data: {
          userId: input.userId,
          provider: 'gemini',
          model: 'mock-gemini',
          requestType: 'series_episode_director',
          inputTokens: 200,
          outputTokens: 500,
          estimatedCost: estimateGeminiCostUsd(200, 500, getGeminiPricingFromEnv()),
          metadata: { seriesId: input.seriesId, episodeId: input.episodeId },
        },
      });
      return data;
    }

    const prompt = buildEpisodeScriptPrompt({
      seriesTitle: input.seriesTitle,
      episodeNumber: input.episodeNumber,
      plannedEpisodeCount: input.plannedEpisodeCount,
      targetDurationSeconds: input.targetDurationSeconds,
      outlineTitle: input.outlineTitle,
      outlineSynopsis: input.outlineSynopsis ?? '',
      outlineHook: input.outlineHook,
      outlineKeyPlot: input.outlineKeyPlot,
      outlineCliffhanger: input.outlineCliffhanger,
      outlineNextSetup: input.outlineNextSetup,
      bibleDigest: input.context.bibleDigest,
      characterDigest: input.context.characterDigest,
      previousEpisodeSummary: input.context.previousEpisodeSummary,
      continuityDigest: input.context.continuityDigest,
      memoryDigest: input.context.memoryDigest,
      unresolvedMysteries: input.context.unresolvedMysteries,
      relationshipsDigest: input.context.relationshipsDigest,
      visualRefsDigest: input.context.visualRefsDigest,
      revisionNotes: input.revisionNotes,
      languageStyleNotes: input.languageStyleNotes,
    });

    const result = await this.gemini.generateJson(
      'series_episode_director',
      prompt,
      episodeScriptPlanSchema,
      {
        responseJsonSchema: episodeScriptPlanJsonSchema as unknown as Record<string, unknown>,
        normalize: normalizeEpisodeScriptPlanInput,
      },
    );

    await this.prisma.providerUsage.create({
      data: {
        userId: input.userId,
        provider: 'gemini',
        model: result.usage.model,
        requestType: 'series_episode_director',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCost: result.usage.estimatedCostUsd,
        metadata: { seriesId: input.seriesId, episodeId: input.episodeId },
      },
    });

    // Force episode number alignment with DB row
    return {
      ...result.data,
      episodeNumber: input.episodeNumber,
      spokenWordCount:
        result.data.spokenWordCount || countSpokenWords(result.data.narrationText),
    };
  }

  private async requireEpisode(userId: string, seriesId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }
}
