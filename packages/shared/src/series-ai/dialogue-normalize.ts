import {
  DIALOGUE_SHOT_TYPES,
  dialogueEpisodeScriptPlanSchema,
  type DialogueEpisodeScriptPlan,
  type DialogueScenePlan,
  type DialogueShotPlan,
} from './dialogue-schemas';

const SHOT_TYPE_SET = new Set<string>(DIALOGUE_SHOT_TYPES);

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v).trim()).filter(Boolean);
}

function mapNamedChanges(
  value: unknown,
  leftKey: string,
  rightKey: string,
): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        [leftKey]: asString(row[leftKey] ?? row.name ?? row.who).trim(),
        [rightKey]: asString(row[rightKey] ?? row.update ?? row.to).trim(),
      };
    })
    .filter((row) => row[leftKey] && row[rightKey]);
}

function mapRelationshipChanges(
  value: unknown,
): Array<{ between: string[]; change: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const between = asStringArray(row.between ?? row.characters).slice(0, 2);
      return {
        between,
        change: asString(row.change ?? row.update).trim(),
      };
    })
    .filter((row) => row.between.length >= 2 && row.change);
}

function mapKnowledgeUpdates(
  value: unknown,
): Array<{ character: string; learned: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        character: asString(row.character ?? row.who).trim(),
        learned: asStringArray(row.learned ?? row.knows ?? row.knowledge),
      };
    })
    .filter((row) => row.character);
}

function normalizeShot(raw: unknown, index: number): DialogueShotPlan {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dialogue = asString(s.dialogue ?? s.line ?? s.text);
  const shotTypeRaw = asString(s.shotType ?? s.shot_type, 'medium_close_up');
  const charactersVisible = asStringArray(
    s.charactersVisible ?? s.characters_visible ?? s.characters,
  );
  const listeners = asStringArray(s.listeners ?? s.listener);
  let speaker = asString(s.speaker ?? s.character ?? s.who).trim();

  // Reaction / silent shots often omit speaker — fill from visible cast so schema stays usable.
  if (!speaker) {
    speaker = charactersVisible[0] || listeners[0] || '';
  }

  const requiresLipSync = asBool(
    s.requiresLipSync ?? s.requires_lip_sync,
    dialogue.trim().length > 0,
  );
  const shotType = (
    SHOT_TYPE_SET.has(shotTypeRaw)
      ? shotTypeRaw
      : dialogue.trim()
        ? 'medium_close_up'
        : 'reaction'
  ) as DialogueShotPlan['shotType'];

  return {
    shotOrder: asNumber(s.shotOrder ?? s.shot_order, index + 1),
    shotType,
    speaker,
    dialogue,
    listeners,
    emotion: asString(s.emotion ?? s.emotionalTone, 'neutral') || 'neutral',
    facialExpression:
      asString(s.facialExpression ?? s.facial_expression, 'natural expression') ||
      'natural expression',
    bodyLanguage:
      asString(s.bodyLanguage ?? s.body_language, 'natural posture') || 'natural posture',
    cameraDirection:
      asString(s.cameraDirection ?? s.camera_direction, 'medium close-up') || 'medium close-up',
    cameraMovement: asString(s.cameraMovement ?? s.camera_movement, 'static') || 'static',
    charactersVisible: charactersVisible.length
      ? charactersVisible
      : speaker
        ? [speaker]
        : ['Character'],
    environment: asString(s.environment ?? s.location, 'indoor scene') || 'indoor scene',
    lighting: asString(s.lighting, 'natural cinematic lighting') || 'natural cinematic lighting',
    durationSeconds: Math.max(1, asNumber(s.durationSeconds ?? s.duration_seconds, 4)),
    requiresLipSync: dialogue.trim() ? true : requiresLipSync,
    ambientSound: asString(s.ambientSound ?? s.ambient_sound),
    musicDirection: asString(s.musicDirection ?? s.music_direction),
    keyProps: asStringArray(s.keyProps ?? s.key_props ?? s.props ?? s.objects).slice(0, 12),
  };
}

function normalizeScene(raw: unknown, index: number): DialogueScenePlan {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shotsRaw = Array.isArray(s.shots) ? s.shots : [];
  const shots = shotsRaw.map((shot, i) => normalizeShot(shot, i));
  const characters = asStringArray(s.characters);
  return {
    sceneNumber: asNumber(s.sceneNumber ?? s.scene_number ?? s.sceneOrder, index + 1),
    durationSeconds: Math.max(
      3,
      asNumber(
        s.durationSeconds ?? s.duration_seconds,
        shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) || 10,
      ),
    ),
    location: asString(s.location, 'Interior') || 'Interior',
    characters: characters.length
      ? characters
      : [...new Set(shots.flatMap((shot) => shot.charactersVisible))],
    backgroundEnvironment: asString(
      s.backgroundEnvironment ?? s.background_environment ?? s.environment,
      asString(s.location, 'Everyday interior'),
    ) || 'Everyday interior',
    emotionalDirection: asString(s.emotionalDirection ?? s.emotional_direction, 'tense') || 'tense',
    ambientSound: asString(s.ambientSound ?? s.ambient_sound),
    musicDirection: asString(s.musicDirection ?? s.music_direction),
    action: asString(s.action, 'Characters converse') || 'Characters converse',
    visualDescription:
      asString(s.visualDescription ?? s.visual_description, 'Cinematic 3D scene') ||
      'Cinematic 3D scene',
    narration: asString(s.narration),
    shots,
  };
}

export function normalizeDialogueEpisodeScriptPlanInput(
  raw: unknown,
): DialogueEpisodeScriptPlan {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scenesRaw = Array.isArray(obj.scenes) ? obj.scenes : [];
  const scenes = scenesRaw.map((scene, i) => normalizeScene(scene, i));

  const dialogueScript =
    asString(obj.script) ||
    scenes
      .flatMap((scene) =>
        scene.shots
          .filter((shot) => shot.dialogue.trim())
          .map((shot) => `${shot.speaker}: ${shot.dialogue}`),
      )
      .join('\n');

  const spokenFromShots = scenes
    .flatMap((scene) => scene.shots)
    .filter((shot) => shot.dialogue.trim())
    .reduce((sum, shot) => sum + shot.dialogue.trim().split(/\s+/).length, 0);

  const continuity =
    obj.continuityChanges && typeof obj.continuityChanges === 'object'
      ? (obj.continuityChanges as Record<string, unknown>)
      : obj.continuity_changes && typeof obj.continuity_changes === 'object'
        ? (obj.continuity_changes as Record<string, unknown>)
        : {};

  const memoryEventsRaw = Array.isArray(obj.memoryEvents)
    ? obj.memoryEvents
    : Array.isArray(obj.memory_events)
      ? obj.memory_events
      : [];

  const normalized = {
    episodeNumber: asNumber(obj.episodeNumber ?? obj.episode_number, 1),
    title: asString(obj.title, 'Untitled Episode') || 'Untitled Episode',
    synopsis: asString(obj.synopsis, 'Episode synopsis') || 'Episode synopsis',
    hook: asString(obj.hook, 'Opening hook') || 'Opening hook',
    ending: asString(obj.ending, 'Episode ending') || 'Episode ending',
    cliffhanger: asString(obj.cliffhanger),
    nextEpisodeSetup:
      asString(obj.nextEpisodeSetup ?? obj.next_episode_setup, 'Continues next') ||
      'Continues next',
    keyPlotDevelopment:
      asString(obj.keyPlotDevelopment ?? obj.key_plot_development, 'Conflict develops') ||
      'Conflict develops',
    emotionalBeats: asStringArray(obj.emotionalBeats ?? obj.emotional_beats),
    spokenWordCount: Math.max(
      1,
      asNumber(obj.spokenWordCount ?? obj.spoken_word_count, spokenFromShots || 1),
    ),
    script: dialogueScript || 'Dialogue script',
    narrationText: asString(obj.narrationText ?? obj.narration_text),
    scenes,
    continuityChanges: {
      characterStateUpdates: mapNamedChanges(
        continuity.characterStateUpdates ?? continuity.character_state_updates,
        'character',
        'change',
      ),
      relationshipUpdates: mapRelationshipChanges(
        continuity.relationshipUpdates ?? continuity.relationship_updates,
      ),
      locationUpdates: mapNamedChanges(
        continuity.locationUpdates ?? continuity.location_updates,
        'character',
        'location',
      ),
      objectOwnershipUpdates: mapNamedChanges(
        continuity.objectOwnershipUpdates ?? continuity.object_ownership_updates,
        'object',
        'owner',
      ),
      newMysteries: asStringArray(continuity.newMysteries ?? continuity.new_mysteries),
      resolvedMysteries: asStringArray(
        continuity.resolvedMysteries ?? continuity.resolved_mysteries,
      ),
      knowledgeUpdates: mapKnowledgeUpdates(
        continuity.knowledgeUpdates ?? continuity.knowledge_updates,
      ),
    },
    memoryEvents: memoryEventsRaw
      .map((item: unknown) => {
        const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          eventType: asString(e.eventType ?? e.event_type, 'plot_event') || 'plot_event',
          title: asString(e.title).trim(),
          description: asString(e.description).trim(),
          affectedCharacters: asStringArray(e.affectedCharacters ?? e.affected_characters),
          importance: asNumber(e.importance, 5),
          audienceKnows: asBool(e.audienceKnows ?? e.audience_knows, true),
          knownByCharacters: asStringArray(e.knownByCharacters ?? e.known_by_characters),
        };
      })
      .filter((e) => e.title && e.description),
  };

  return dialogueEpisodeScriptPlanSchema.parse(normalized);
}
