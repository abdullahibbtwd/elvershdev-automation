function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return fallback;
}

/** Gemini often overshoots short visual fields; truncate before Zod so plans don't FAIL. */
function asBoundedString(value: unknown, max: number, fallback = ''): string {
  const raw = asString(value, fallback).trim();
  if (!raw) return fallback;
  return raw.length <= max ? raw : raw.slice(0, max).trimEnd();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function normalizeMoviePremiseInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    title: asString(obj.title),
    logline: asString(obj.logline),
    synopsis: asString(obj.synopsis),
    genre: asString(obj.genre),
    subgenres: asStringArray(obj.subgenres),
    targetAudience: asString(obj.targetAudience ?? obj.target_audience),
    setting: asString(obj.setting),
    worldRules: asString(obj.worldRules ?? obj.world_rules),
    mainConflict: asString(obj.mainConflict ?? obj.main_conflict),
    visualStyle: asString(obj.visualStyle ?? obj.visual_style),
  };
}

export function normalizeMovieCharactersPlanInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.characters) ? obj.characters : [];
  return {
    characters: list.map((item) => {
      const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        name: asBoundedString(c.name, 100),
        role: asString(c.role, 'SUPPORTING').toUpperCase(),
        species: asBoundedString(c.species, 100, 'human'),
        ageRange: asBoundedString(c.ageRange ?? c.age_range, 50, 'adult'),
        personality: asString(c.personality),
        motivation: asString(c.motivation),
        backstory: asString(c.backstory),
        physicalDescription: asString(c.physicalDescription ?? c.physical_description),
        facialStructure: asString(c.facialStructure ?? c.facial_structure),
        eyeColor: asBoundedString(c.eyeColor ?? c.eye_color, 80),
        eyeShape: asBoundedString(c.eyeShape ?? c.eye_shape, 80),
        hairFurColor: asBoundedString(c.hairFurColor ?? c.hair_fur_color, 120),
        markings: asString(c.markings, 'none'),
        bodyProportions: asString(c.bodyProportions ?? c.body_proportions),
        clothing: asString(c.clothing),
        accessories: asString(c.accessories, 'none'),
        heightRelative: asBoundedString(c.heightRelative ?? c.height_relative, 200),
        voiceProfile: asString(c.voiceProfile ?? c.voice_profile),
        emotionalCharacteristics: asString(
          c.emotionalCharacteristics ?? c.emotional_characteristics,
        ),
        relationships: Array.isArray(c.relationships)
          ? c.relationships.map((rel) => {
              const r = (rel && typeof rel === 'object' ? rel : {}) as Record<string, unknown>;
              return {
                withCharacter: asString(r.withCharacter ?? r.with_character),
                relationship: asString(r.relationship),
                dynamics: asString(r.dynamics),
              };
            })
          : [],
        secrets: asStringArray(c.secrets),
        flaws: asStringArray(c.flaws),
        canonicalVisualDescription: asString(
          c.canonicalVisualDescription ?? c.canonical_visual_description,
        ),
        visualConsistencyNotes: asString(
          c.visualConsistencyNotes ?? c.visual_consistency_notes,
        ),
      };
    }),
  };
}

export function normalizeMovieArcPlanInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const knowledge =
    obj.knowledgeMap && typeof obj.knowledgeMap === 'object'
      ? (obj.knowledgeMap as Record<string, unknown>)
      : {};
  return {
    premise: asString(obj.premise),
    masterPlot: asString(obj.masterPlot ?? obj.master_plot),
    beginning: asString(obj.beginning),
    middle: asString(obj.middle),
    climax: asString(obj.climax),
    resolution: asString(obj.resolution),
    ending: asString(obj.ending),
    majorConflicts: asString(obj.majorConflicts ?? obj.major_conflicts),
    secrets: Array.isArray(obj.secrets)
      ? obj.secrets.map((item, index) => {
          const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            id: asString(s.id, `secret-${index + 1}`),
            secret: asString(s.secret),
            audienceKnows: asBoolean(s.audienceKnows ?? s.audience_knows),
            knownByCharacters: asStringArray(s.knownByCharacters ?? s.known_by_characters),
            unawareCharacters: asStringArray(s.unawareCharacters ?? s.unaware_characters),
            revealEpisode:
              s.revealEpisode != null || s.reveal_episode != null
                ? asNumber(s.revealEpisode ?? s.reveal_episode)
                : undefined,
          };
        })
      : [],
    reveals: Array.isArray(obj.reveals)
      ? obj.reveals.map((item) => {
          const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            episodeNumber: asNumber(r.episodeNumber ?? r.episode_number, 1),
            reveal: asString(r.reveal),
            payoffOf: r.payoffOf != null || r.payoff_of != null
              ? asString(r.payoffOf ?? r.payoff_of)
              : undefined,
          };
        })
      : [],
    foreshadowingMap: (() => {
      const list = obj.foreshadowingMap ?? obj.foreshadowing_map;
      if (!Array.isArray(list)) return [];
      return list.map((item: unknown) => {
        const f = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          plantEpisode: asNumber(f.plantEpisode ?? f.plant_episode, 1),
          payoffEpisode: asNumber(f.payoffEpisode ?? f.payoff_episode, 1),
          detail: asString(f.detail),
        };
      });
    })(),
    characterArcs: (() => {
      const list = obj.characterArcs ?? obj.character_arcs;
      if (!Array.isArray(list)) return [];
      return list.map((item: unknown) => {
        const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          character: asString(a.character),
          startingState: asString(a.startingState ?? a.starting_state),
          endingState: asString(a.endingState ?? a.ending_state),
          keyTurningPoints: asStringArray(a.keyTurningPoints ?? a.key_turning_points),
        };
      });
    })(),
    knowledgeMap: {
      audience: asStringArray(knowledge.audience),
      byCharacter: (() => {
        const list = knowledge.byCharacter ?? knowledge.by_character;
        if (!Array.isArray(list)) return [];
        return list.map((item: unknown) => {
          const k = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            character: asString(k.character),
            knows: asStringArray(k.knows),
            doesNotKnow: asStringArray(k.doesNotKnow ?? k.does_not_know),
          };
        });
      })(),
    },
  };
}

export function normalizeEpisodeOutlinesBatchInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.episodes) ? obj.episodes : [];
  return {
    episodes: list.map((item) => {
      const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        episodeNumber: asNumber(e.episodeNumber ?? e.episode_number, 1),
        title: asString(e.title),
        synopsis: asString(e.synopsis),
        hook: asString(e.hook),
        keyPlotDevelopment: asString(e.keyPlotDevelopment ?? e.key_plot_development),
        emotionalBeat: asString(e.emotionalBeat ?? e.emotional_beat),
        cliffhangerOrEnding: asString(e.cliffhangerOrEnding ?? e.cliffhanger_or_ending),
        nextEpisodeSetup: asString(e.nextEpisodeSetup ?? e.next_episode_setup),
        charactersFeatured: asStringArray(e.charactersFeatured ?? e.characters_featured),
        reveals: asStringArray(e.reveals),
        continuityNotes: asString(e.continuityNotes ?? e.continuity_notes),
      };
    }),
  };
}

export function normalizeStoryQualityScoreInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const explanations =
    obj.explanations && typeof obj.explanations === 'object'
      ? Object.fromEntries(
          Object.entries(obj.explanations as Record<string, unknown>).map(([k, v]) => [
            k,
            asString(v),
          ]),
        )
      : {};
  return {
    originality: asNumber(obj.originality),
    characterDepth: asNumber(obj.characterDepth ?? obj.character_depth),
    emotionalEngagement: asNumber(obj.emotionalEngagement ?? obj.emotional_engagement),
    suspense: asNumber(obj.suspense),
    plotCoherence: asNumber(obj.plotCoherence ?? obj.plot_coherence),
    episodeProgression: asNumber(obj.episodeProgression ?? obj.episode_progression),
    cliffhangerPayoffQuality: asNumber(
      obj.cliffhangerPayoffQuality ?? obj.cliffhanger_payoff_quality,
    ),
    dialoguePotential: asNumber(obj.dialoguePotential ?? obj.dialogue_potential),
    continuity: asNumber(obj.continuity),
    completeStoryResolution: asNumber(
      obj.completeStoryResolution ?? obj.complete_story_resolution,
    ),
    overall: asNumber(obj.overall),
    explanations,
    accepted: asBoolean(obj.accepted),
    rejectionReasons: asStringArray(obj.rejectionReasons ?? obj.rejection_reasons),
    note: asString(
      obj.note,
      'Scores measure story craft only. They do not predict audience reach or viral performance.',
    ),
  };
}
