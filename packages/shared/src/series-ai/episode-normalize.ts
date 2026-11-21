import type { ContinuitySnapshotState, EpisodeScriptPlan } from './episode-schemas';

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return fallback;
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

export function normalizeEpisodeScriptPlanInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const changes =
    obj.continuityChanges && typeof obj.continuityChanges === 'object'
      ? (obj.continuityChanges as Record<string, unknown>)
      : obj.continuity_changes && typeof obj.continuity_changes === 'object'
        ? (obj.continuity_changes as Record<string, unknown>)
        : {};

  const scenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  const memoryEvents = Array.isArray(obj.memoryEvents)
    ? obj.memoryEvents
    : Array.isArray(obj.memory_events)
      ? obj.memory_events
      : [];

  const script = asString(obj.script);
  const narrationRaw = asString(obj.narrationText ?? obj.narration_text).trim();
  // Dialogue-style model output often leaves narration empty — keep schema happy and
  // preserve spoken words via script for legacy consumers / word counts.
  const narrationText = narrationRaw || script;

  return {
    episodeNumber: asNumber(obj.episodeNumber ?? obj.episode_number, 1),
    title: asString(obj.title),
    synopsis: asString(obj.synopsis),
    hook: asString(obj.hook),
    narrationText,
    script,
    ending: asString(obj.ending),
    cliffhanger: asString(obj.cliffhanger),
    nextEpisodeSetup: asString(obj.nextEpisodeSetup ?? obj.next_episode_setup),
    keyPlotDevelopment: asString(obj.keyPlotDevelopment ?? obj.key_plot_development),
    emotionalBeats: asStringArray(obj.emotionalBeats ?? obj.emotional_beats),
    spokenWordCount: asNumber(obj.spokenWordCount ?? obj.spoken_word_count, 120),
    scenes: scenes.map((item: unknown, index: number) => {
      const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        sceneOrder: asNumber(s.sceneOrder ?? s.scene_order, index + 1),
        location: asString(s.location),
        characters: asStringArray(s.characters),
        action: asString(s.action),
        visualDescription: asString(s.visualDescription ?? s.visual_description),
        dialogue: asString(s.dialogue),
        narration: asString(s.narration),
        emotionalDirection: asString(s.emotionalDirection ?? s.emotional_direction),
        shotDirection: asString(s.shotDirection ?? s.shot_direction),
      };
    }),
    continuityChanges: {
      characterStateUpdates: mapNamedChanges(
        changes.characterStateUpdates ?? changes.character_state_updates,
        'character',
        'change',
      ),
      relationshipUpdates: mapRelationshipChanges(
        changes.relationshipUpdates ?? changes.relationship_updates,
      ),
      locationUpdates: mapNamedChanges(
        changes.locationUpdates ?? changes.location_updates,
        'character',
        'location',
      ),
      objectOwnershipUpdates: mapNamedChanges(
        changes.objectOwnershipUpdates ?? changes.object_ownership_updates,
        'object',
        'owner',
      ),
      newMysteries: asStringArray(changes.newMysteries ?? changes.new_mysteries),
      resolvedMysteries: asStringArray(changes.resolvedMysteries ?? changes.resolved_mysteries),
      knowledgeUpdates: mapKnowledgeUpdates(
        changes.knowledgeUpdates ?? changes.knowledge_updates,
      ),
    },
    memoryEvents: memoryEvents.map((item: unknown) => {
      const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        eventType: asString(e.eventType ?? e.event_type, 'plot_event'),
        title: asString(e.title),
        description: asString(e.description),
        affectedCharacters: asStringArray(e.affectedCharacters ?? e.affected_characters),
        importance: asNumber(e.importance, 5),
        audienceKnows: asBoolean(e.audienceKnows ?? e.audience_knows, true),
        knownByCharacters: asStringArray(e.knownByCharacters ?? e.known_by_characters),
      };
    }),
  };
}

export function normalizeContinuityValidationInput(raw: unknown): unknown {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const issues = Array.isArray(obj.issues) ? obj.issues : [];
  return {
    valid: asBoolean(obj.valid),
    stage: asString(obj.stage, 'pre_script_approval'),
    issues: issues.map((item: unknown) => {
      const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        code: asString(i.code, 'continuity_issue'),
        severity: asString(i.severity, 'error') === 'warning' ? 'warning' : 'error',
        message: asString(i.message),
        conflictingEvent:
          i.conflictingEvent != null || i.conflicting_event != null
            ? asString(i.conflictingEvent ?? i.conflicting_event)
            : undefined,
        suggestedFix:
          i.suggestedFix != null || i.suggested_fix != null
            ? asString(i.suggestedFix ?? i.suggested_fix)
            : undefined,
      };
    }),
    summary: asString(obj.summary, 'Continuity validation completed'),
  };
}

function mapNamedChanges(
  value: unknown,
  leftKey: string,
  rightKey: string,
): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      [leftKey]: asString(row[leftKey]),
      [rightKey]: asString(row[rightKey]),
    };
  });
}

function mapRelationshipChanges(value: unknown): Array<{ between: string[]; change: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      between: asStringArray(row.between).slice(0, 2),
      change: asString(row.change),
    };
  });
}

function mapKnowledgeUpdates(
  value: unknown,
): Array<{ character: string; learned: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      character: asString(row.character),
      learned: asStringArray(row.learned),
    };
  });
}

export function countSpokenWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function applyContinuityChanges(
  base: ContinuitySnapshotState,
  plan: EpisodeScriptPlan,
): ContinuitySnapshotState {
  const next: ContinuitySnapshotState = {
    characterStates: { ...base.characterStates },
    relationships: { ...base.relationships },
    locations: { ...base.locations },
    objectOwnership: { ...base.objectOwnership },
    openMysteries: [...base.openMysteries],
    knowledgeState: {
      audience: [...base.knowledgeState.audience],
      byCharacter: { ...base.knowledgeState.byCharacter },
    },
    timelineNotes: base.timelineNotes,
    summary: plan.synopsis,
  };

  for (const update of plan.continuityChanges.characterStateUpdates) {
    next.characterStates[update.character] = update.change;
  }
  for (const update of plan.continuityChanges.relationshipUpdates) {
    const key = [...update.between].sort().join('|');
    next.relationships[key] = update.change;
  }
  for (const update of plan.continuityChanges.locationUpdates) {
    next.locations[update.character] = update.location;
  }
  for (const update of plan.continuityChanges.objectOwnershipUpdates) {
    next.objectOwnership[update.object] = update.owner;
  }
  for (const mystery of plan.continuityChanges.newMysteries) {
    if (!next.openMysteries.includes(mystery)) next.openMysteries.push(mystery);
  }
  next.openMysteries = next.openMysteries.filter(
    (m) => !plan.continuityChanges.resolvedMysteries.includes(m),
  );
  for (const update of plan.continuityChanges.knowledgeUpdates) {
    const existing = next.knowledgeState.byCharacter[update.character] ?? [];
    next.knowledgeState.byCharacter[update.character] = [
      ...new Set([...existing, ...update.learned]),
    ];
  }

  return next;
}
