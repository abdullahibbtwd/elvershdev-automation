import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeriesContinuityPoint,
  SeriesMemoryVisibility,
} from '@prisma/client';
import {
  applyContinuityChanges,
  buildContinuityValidationPrompt,
  continuitySnapshotStateSchema,
  continuityValidationResultJsonSchema,
  continuityValidationResultSchema,
  createEmptyContinuitySnapshot,
  createMockContinuityValidation,
  normalizeContinuityValidationInput,
  type ContinuitySnapshotState,
  type ContinuityValidationResult,
  type EpisodeScriptPlan,
} from '@ai-video/shared';
import { GeminiProvider } from '../../integrations/providers/gemini.provider';
import { PrismaService } from '../../prisma/prisma.service';

export type ContinuityStage = 'pre_script_approval' | 'pre_visual';

@Injectable()
export class ContinuityEngineService {
  private readonly logger = new Logger(ContinuityEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiProvider,
  ) {}

  async getContinuityView(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { id: true, title: true },
    });
    if (!series) throw new NotFoundException('Series not found');

    const [snapshots, memoryEvents, openEpisode] = await Promise.all([
      this.prisma.seriesContinuitySnapshot.findMany({
        where: { seriesId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: {
          episode: { select: { id: true, episodeNumber: true, title: true } },
        },
      }),
      this.prisma.seriesMemoryEvent.findMany({
        where: { seriesId },
        orderBy: [{ episodeNumber: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.seriesEpisode.findFirst({
        where: { seriesId },
        orderBy: { episodeNumber: 'desc' },
        select: { id: true, episodeNumber: true, status: true },
      }),
    ]);

    return {
      series,
      latestSnapshot: snapshots[0] ?? null,
      snapshots,
      memoryEvents,
      latestEpisode: openEpisode,
    };
  }

  async buildCompactContext(seriesId: string, episodeNumber: number) {
    const series = await this.prisma.storySeries.findUniqueOrThrow({
      where: { id: seriesId },
      include: {
        bible: true,
        characters: {
          orderBy: { sortOrder: 'asc' },
          include: {
            referenceAssets: {
              where: { isApproved: true, isPrimary: true },
              take: 1,
            },
          },
        },
      },
    });

    const previousEpisode = await this.prisma.seriesEpisode.findFirst({
      where: {
        seriesId,
        episodeNumber: { lt: episodeNumber },
        status: { not: 'SKIPPED' },
      },
      orderBy: { episodeNumber: 'desc' },
    });

    const latestAfterSnapshot = previousEpisode
      ? await this.prisma.seriesContinuitySnapshot.findUnique({
          where: {
            episodeId_point: {
              episodeId: previousEpisode.id,
              point: SeriesContinuityPoint.AFTER,
            },
          },
        })
      : null;

    const memoryEvents = await this.prisma.seriesMemoryEvent.findMany({
      where: {
        seriesId,
        OR: [
          { episodeNumber: { lt: episodeNumber } },
          { episodeNumber: null, createdAt: { lte: new Date() } },
        ],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: 25,
    });

    const snapshotState = latestAfterSnapshot
      ? continuitySnapshotStateSchema.parse({
          characterStates: latestAfterSnapshot.characterStates ?? {},
          relationships: latestAfterSnapshot.relationships ?? {},
          locations: latestAfterSnapshot.locations ?? {},
          objectOwnership: latestAfterSnapshot.objectOwnership ?? {},
          openMysteries: latestAfterSnapshot.openMysteries ?? [],
          knowledgeState: latestAfterSnapshot.knowledgeState ?? {
            audience: [],
            byCharacter: {},
          },
          timelineNotes: latestAfterSnapshot.timelineNotes ?? '',
          summary: latestAfterSnapshot.summary ?? '',
        })
      : this.seedSnapshotFromBible(series);

    const bibleDigest = series.bible
      ? [
          `Premise: ${series.bible.premise}`,
          `Setting: ${series.bible.setting}`,
          `World rules: ${series.bible.worldRules}`,
          `Master plot: ${series.bible.masterPlot}`,
          `Beginning: ${truncate(series.bible.beginning, 400)}`,
          `Middle: ${truncate(series.bible.middle, 400)}`,
          `Climax: ${truncate(series.bible.climax, 300)}`,
          `Ending (locked): ${truncate(series.bible.ending, 400)}`,
        ].join('\n')
      : 'No bible available';

    const characterDigest = series.characters
      .map(
        (c) =>
          `- ${c.name} (${c.role}, ${c.species}): ${c.canonicalVisualDescription ?? c.physicalDescription}; knows secrets=${JSON.stringify(c.secrets)}; status=${c.lifecycleStatus}`,
      )
      .join('\n');

    const relationshipsDigest = series.characters
      .map((c) => `- ${c.name}: ${JSON.stringify(c.relationships)}`)
      .join('\n');

    const visualRefsDigest = series.characters
      .map((c) => {
        const ref = c.referenceAssets[0];
        return ref
          ? `- ${c.name}: approved primary ref asset ${ref.id} v${ref.version}`
          : `- ${c.name}: no approved primary ref yet`;
      })
      .join('\n');

    const memoryDigest = memoryEvents
      .map(
        (m) =>
          `- [ep ${m.episodeNumber ?? '?'}|${m.eventType}|imp ${m.importance}] ${m.title}: ${m.description} (audienceKnows=${m.audienceKnows}; knownBy=${m.knownByCharacterIds.join(',') || 'n/a'})`,
      )
      .join('\n');

    const unresolvedMysteries =
      (Array.isArray(snapshotState.openMysteries) ? snapshotState.openMysteries : []).join(
        '\n- ',
      ) || 'None';

    return {
      series,
      previousEpisode,
      snapshotState,
      bibleDigest,
      characterDigest,
      relationshipsDigest,
      visualRefsDigest,
      memoryDigest,
      unresolvedMysteries: unresolvedMysteries.startsWith('None')
        ? unresolvedMysteries
        : `- ${unresolvedMysteries}`,
      continuityDigest: JSON.stringify(snapshotState),
      previousEpisodeSummary: previousEpisode
        ? [
            `Episode ${previousEpisode.episodeNumber}: ${previousEpisode.title}`,
            previousEpisode.synopsis ?? '',
            previousEpisode.ending ?? '',
            previousEpisode.nextEpisodeSetup ?? '',
          ]
            .filter(Boolean)
            .join(' | ')
        : '',
      memoryEvents,
      characterNameToId: Object.fromEntries(series.characters.map((c) => [c.name, c.id])),
    };
  }

  /**
   * Deterministic local checks + optional Gemini review.
   * Never auto-overwrites approved canon.
   */
  async validateEpisode(input: {
    userId: string;
    seriesId: string;
    episodeId: string;
    stage: ContinuityStage;
    plan?: EpisodeScriptPlan;
    useMockAi?: boolean;
    /** Prefer local checks + prior generation validation; skip live Gemini recheck. */
    preferStoredValidation?: boolean;
  }): Promise<ContinuityValidationResult> {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: input.episodeId, seriesId: input.seriesId, series: { userId: input.userId } },
      include: { scenes: { orderBy: { sceneOrder: 'asc' } } },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    const context = await this.buildCompactContext(input.seriesId, episode.episodeNumber);
    const plan = input.plan ?? (await this.hydratePlanFromEpisode(episode));

    if (!plan?.script) {
      throw new BadRequestException('Episode has no script to validate');
    }

    const localIssues = this.runLocalChecks(plan, context);
    const meta = (episode.metadata ?? {}) as Record<string, unknown>;
    const stored = meta.continuityValidation as ContinuityValidationResult | undefined;

    // Approve / Run Now previously rebuilt an empty plan (no scenes) and re-called Gemini,
    // which false-failed episodes that already passed generation-time validation.
    if (
      input.preferStoredValidation &&
      input.stage === 'pre_script_approval' &&
      stored?.valid === true &&
      localIssues.length === 0
    ) {
      const trusted: ContinuityValidationResult = {
        valid: true,
        stage: input.stage,
        issues: [],
        summary: stored.summary || 'Trusted prior generation continuity validation.',
      };
      this.logger.log(
        `Continuity ${input.stage} episode=${episode.id} valid=true (trusted stored) issues=0`,
      );
      return trusted;
    }

    let modelResult: ContinuityValidationResult;

    if (input.useMockAi || this.gemini.shouldUseMock()) {
      modelResult = createMockContinuityValidation(input.stage, localIssues.length === 0);
      if (localIssues.length) {
        modelResult = {
          valid: false,
          stage: input.stage,
          issues: localIssues,
          summary: 'Local continuity checks failed.',
        };
      }
    } else {
      const prompt = buildContinuityValidationPrompt({
        stage: input.stage,
        seriesTitle: context.series.title,
        episodeNumber: episode.episodeNumber,
        episodeScriptDigest: truncate(
          `${plan.hook}\n${plan.script}\n${plan.ending}\n${JSON.stringify(plan.continuityChanges)}`,
          6000,
        ),
        bibleDigest: context.bibleDigest,
        characterDigest: context.characterDigest,
        continuityDigest: context.continuityDigest,
        memoryDigest: context.memoryDigest,
      });
      const result = await this.gemini.generateJson(
        'series_continuity_validation',
        prompt,
        continuityValidationResultSchema,
        {
          responseJsonSchema:
            continuityValidationResultJsonSchema as unknown as Record<string, unknown>,
          normalize: normalizeContinuityValidationInput,
        },
      );
      await this.prisma.providerUsage.create({
        data: {
          userId: input.userId,
          provider: 'gemini',
          model: result.usage.model,
          requestType: 'series_continuity_validation',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCost: result.usage.estimatedCostUsd,
          metadata: { seriesId: input.seriesId, episodeId: input.episodeId, stage: input.stage },
        },
      });
      modelResult = result.data;
      modelResult.issues = [...localIssues, ...modelResult.issues];
      modelResult.valid =
        modelResult.issues.filter((i) => i.severity === 'error').length === 0;
      if (!modelResult.valid && !modelResult.summary.includes('error')) {
        modelResult.summary = 'Continuity errors detected.';
      }
    }

    // Force stage onto result
    modelResult.stage = input.stage;
    modelResult.valid = modelResult.issues.every((i) => i.severity !== 'error');

    this.logger.log(
      `Continuity ${input.stage} episode=${episode.id} valid=${modelResult.valid} issues=${modelResult.issues.length}`,
    );
    return modelResult;
  }

  async persistAfterEpisode(input: {
    seriesId: string;
    episodeId: string;
    episodeNumber: number;
    plan: EpisodeScriptPlan;
    characterNameToId: Record<string, string>;
    beforeState: ContinuitySnapshotState;
  }) {
    const afterState = applyContinuityChanges(input.beforeState, input.plan);

    await this.prisma.$transaction(async (tx) => {
      await tx.seriesContinuitySnapshot.upsert({
        where: {
          episodeId_point: {
            episodeId: input.episodeId,
            point: SeriesContinuityPoint.BEFORE,
          },
        },
        create: {
          seriesId: input.seriesId,
          episodeId: input.episodeId,
          point: SeriesContinuityPoint.BEFORE,
          characterStates: input.beforeState.characterStates as Prisma.InputJsonValue,
          relationships: input.beforeState.relationships as Prisma.InputJsonValue,
          locations: input.beforeState.locations as Prisma.InputJsonValue,
          objectOwnership: input.beforeState.objectOwnership as Prisma.InputJsonValue,
          openMysteries: input.beforeState.openMysteries as Prisma.InputJsonValue,
          knowledgeState: input.beforeState.knowledgeState as Prisma.InputJsonValue,
          timelineNotes: input.beforeState.timelineNotes,
          summary: input.beforeState.summary || `Before episode ${input.episodeNumber}`,
        },
        update: {
          characterStates: input.beforeState.characterStates as Prisma.InputJsonValue,
          relationships: input.beforeState.relationships as Prisma.InputJsonValue,
          locations: input.beforeState.locations as Prisma.InputJsonValue,
          objectOwnership: input.beforeState.objectOwnership as Prisma.InputJsonValue,
          openMysteries: input.beforeState.openMysteries as Prisma.InputJsonValue,
          knowledgeState: input.beforeState.knowledgeState as Prisma.InputJsonValue,
          timelineNotes: input.beforeState.timelineNotes,
          summary: input.beforeState.summary || `Before episode ${input.episodeNumber}`,
        },
      });

      await tx.seriesContinuitySnapshot.upsert({
        where: {
          episodeId_point: {
            episodeId: input.episodeId,
            point: SeriesContinuityPoint.AFTER,
          },
        },
        create: {
          seriesId: input.seriesId,
          episodeId: input.episodeId,
          point: SeriesContinuityPoint.AFTER,
          characterStates: afterState.characterStates as Prisma.InputJsonValue,
          relationships: afterState.relationships as Prisma.InputJsonValue,
          locations: afterState.locations as Prisma.InputJsonValue,
          objectOwnership: afterState.objectOwnership as Prisma.InputJsonValue,
          openMysteries: afterState.openMysteries as Prisma.InputJsonValue,
          knowledgeState: afterState.knowledgeState as Prisma.InputJsonValue,
          timelineNotes: afterState.timelineNotes,
          summary: afterState.summary || input.plan.synopsis,
        },
        update: {
          characterStates: afterState.characterStates as Prisma.InputJsonValue,
          relationships: afterState.relationships as Prisma.InputJsonValue,
          locations: afterState.locations as Prisma.InputJsonValue,
          objectOwnership: afterState.objectOwnership as Prisma.InputJsonValue,
          openMysteries: afterState.openMysteries as Prisma.InputJsonValue,
          knowledgeState: afterState.knowledgeState as Prisma.InputJsonValue,
          timelineNotes: afterState.timelineNotes,
          summary: afterState.summary || input.plan.synopsis,
        },
      });

      // Replace memory events for this episode on regenerate (immutable history per generation write)
      await tx.seriesMemoryEvent.deleteMany({
        where: { seriesId: input.seriesId, episodeId: input.episodeId },
      });

      for (const event of input.plan.memoryEvents) {
        const affected = event.affectedCharacters
          .map((name) => input.characterNameToId[name])
          .filter(Boolean);
        const knownBy = event.knownByCharacters
          .map((name) => input.characterNameToId[name])
          .filter(Boolean);
        await tx.seriesMemoryEvent.create({
          data: {
            seriesId: input.seriesId,
            episodeId: input.episodeId,
            episodeNumber: input.episodeNumber,
            eventType: event.eventType,
            title: event.title,
            description: event.description,
            affectedCharacterIds: affected,
            importance: event.importance,
            visibility: event.audienceKnows
              ? SeriesMemoryVisibility.PUBLIC
              : SeriesMemoryVisibility.CHARACTER_RESTRICTED,
            knownByCharacterIds: knownBy,
            audienceKnows: event.audienceKnows,
            occurredAt: new Date(),
          },
        });
      }
    });

    return afterState;
  }

  /** Rebuild a full EpisodeScriptPlan from persisted episode + scenes (for approve revalidation). */
  private async hydratePlanFromEpisode(episode: {
    episodeNumber: number;
    title: string;
    synopsis: string | null;
    hook: string | null;
    narrationText: string | null;
    script: string | null;
    ending: string | null;
    cliffhanger: string | null;
    nextEpisodeSetup: string | null;
    spokenWordCount: number | null;
    continuityChanges: unknown;
    metadata: unknown;
    scenes: Array<{
      sceneOrder: number;
      location: string;
      characters: unknown;
      action: string;
      visualDescription: string | null;
      dialogue: string | null;
      narration: string | null;
      emotionalDirection: string | null;
      shotDirection: string | null;
    }>;
  }): Promise<EpisodeScriptPlan | null> {
    if (!episode.script) return null;

    const meta = (episode.metadata ?? {}) as Record<string, unknown>;
    const changes = (episode.continuityChanges ?? {}) as Record<string, unknown>;
    const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

    return {
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      synopsis: episode.synopsis ?? '',
      hook: episode.hook ?? '',
      narrationText: episode.narrationText ?? '',
      script: episode.script,
      ending: episode.ending ?? '',
      cliffhanger: episode.cliffhanger ?? '',
      nextEpisodeSetup: episode.nextEpisodeSetup ?? '',
      keyPlotDevelopment:
        typeof meta.keyPlotDevelopment === 'string' ? meta.keyPlotDevelopment : '',
      emotionalBeats: asArray<string>(meta.emotionalBeats),
      spokenWordCount: episode.spokenWordCount ?? 0,
      scenes: episode.scenes.map((scene) => ({
        sceneOrder: scene.sceneOrder,
        location: scene.location,
        characters: asArray<string>(scene.characters),
        action: scene.action,
        visualDescription: scene.visualDescription ?? '',
        dialogue: scene.dialogue ?? '',
        narration: scene.narration ?? '',
        emotionalDirection: scene.emotionalDirection ?? '',
        shotDirection: scene.shotDirection ?? '',
      })),
      continuityChanges: {
        characterStateUpdates: asArray(changes.characterStateUpdates),
        relationshipUpdates: asArray(changes.relationshipUpdates),
        locationUpdates: asArray(changes.locationUpdates),
        objectOwnershipUpdates: asArray(changes.objectOwnershipUpdates),
        newMysteries: asArray<string>(changes.newMysteries),
        resolvedMysteries: asArray<string>(changes.resolvedMysteries),
        knowledgeUpdates: asArray(changes.knowledgeUpdates),
      },
      memoryEvents: [],
    };
  }

  /**
   * Local deterministic checks used in tests and as a hard gate before model results.
   */
  runLocalChecks(
    plan: EpisodeScriptPlan,
    context: {
      snapshotState: ContinuitySnapshotState;
      series: { characters: Array<{ name: string; canonicalVisualDescription: string | null }> };
      memoryEvents: Array<{
        title: string;
        description: string;
        audienceKnows: boolean;
        knownByCharacterIds: string[];
      }>;
      characterNameToId: Record<string, string>;
    },
  ): ContinuityValidationResult['issues'] {
    const issues: ContinuityValidationResult['issues'] = [];
    const knownNames = new Set(context.series.characters.map((c) => c.name));

    for (const scene of plan.scenes) {
      for (const name of scene.characters) {
        if (!knownNames.has(name)) {
          issues.push({
            code: 'unknown_character',
            severity: 'error',
            message: `Scene ${scene.sceneOrder} references unknown character "${name}".`,
            suggestedFix: 'Use only approved series character names.',
          });
        }
      }
    }

    // Characters must not suddenly know restricted secrets from memory where they are absent.
    for (const update of plan.continuityChanges.knowledgeUpdates) {
      for (const fact of update.learned) {
        const blocked = context.memoryEvents.find(
          (m) =>
            !m.audienceKnows &&
            m.description.toLowerCase().includes(fact.toLowerCase()) &&
            !m.knownByCharacterIds.includes(context.characterNameToId[update.character] ?? ''),
        );
        if (blocked) {
          issues.push({
            code: 'knowledge_violation',
            severity: 'error',
            message: `${update.character} learns "${fact}" without prior discovery rights.`,
            conflictingEvent: `${blocked.title}: ${blocked.description}`,
            suggestedFix: 'Remove the knowledge update or introduce a discovery beat first.',
          });
        }
      }
    }

    // Appearance lock: narration/script should not invent a totally different species label for known cast.
    for (const character of context.series.characters) {
      const description = (character.canonicalVisualDescription ?? '').toLowerCase();
      if (!description) continue;
      if (
        description.includes('fox') &&
        plan.script.toLowerCase().includes(character.name.toLowerCase()) &&
        /turns into a human|becomes human|no longer a fox/i.test(plan.script)
      ) {
        issues.push({
          code: 'identity_change',
          severity: 'error',
          message: `Script alters approved identity for ${character.name}.`,
          conflictingEvent: character.canonicalVisualDescription ?? undefined,
          suggestedFix: 'Keep approved species and visual identity unchanged.',
        });
      }
    }

    return issues;
  }

  private seedSnapshotFromBible(series: {
    bible: {
      knowledgeMap: unknown;
      secrets: unknown;
      ending: string;
    } | null;
    characters: Array<{ name: string; relationships: unknown }>;
  }): ContinuitySnapshotState {
    const base = createEmptyContinuitySnapshot('Seeded from series bible');
    if (!series.bible) return base;

    const knowledge = series.bible.knowledgeMap as {
      audience?: string[];
      byCharacter?: Array<{ character: string; knows?: string[]; doesNotKnow?: string[] }>;
    } | null;

    if (knowledge) {
      base.knowledgeState.audience = knowledge.audience ?? [];
      for (const row of knowledge.byCharacter ?? []) {
        base.knowledgeState.byCharacter[row.character] = row.knows ?? [];
      }
    }

    if (Array.isArray(series.bible.secrets)) {
      for (const secret of series.bible.secrets as Array<{ secret?: string; audienceKnows?: boolean }>) {
        if (secret?.secret && secret.audienceKnows === false) {
          base.openMysteries.push(secret.secret);
        }
      }
    }

    for (const character of series.characters) {
      base.characterStates[character.name] = 'Active as of series start';
      if (Array.isArray(character.relationships)) {
        for (const rel of character.relationships as Array<{
          withCharacter?: string;
          relationship?: string;
          dynamics?: string;
        }>) {
          if (!rel.withCharacter) continue;
          const key = [character.name, rel.withCharacter].sort().join('|');
          base.relationships[key] = `${rel.relationship ?? 'linked'}: ${rel.dynamics ?? ''}`.trim();
        }
      }
    }

    return base;
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
