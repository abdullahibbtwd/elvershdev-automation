import {
  dialogueEpisodeScriptPlanSchema,
  type DialogueEpisodeScriptPlan,
  type DialogueScenePlan,
  type DialogueShotPlan,
} from './dialogue-schemas';

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

function normalizeShot(raw: unknown, index: number): DialogueShotPlan {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dialogue = asString(s.dialogue ?? s.line ?? s.text);
  const shotTypeRaw = asString(s.shotType ?? s.shot_type, 'medium_close_up');
  return {
    shotOrder: asNumber(s.shotOrder ?? s.shot_order, index + 1),
    shotType: shotTypeRaw as DialogueShotPlan['shotType'],
    speaker: asString(s.speaker ?? s.character ?? s.who),
    dialogue,
    listeners: asStringArray(s.listeners ?? s.listener),
    emotion: asString(s.emotion ?? s.emotionalTone, 'neutral'),
    facialExpression: asString(s.facialExpression ?? s.facial_expression, 'natural expression'),
    bodyLanguage: asString(s.bodyLanguage ?? s.body_language, 'natural posture'),
    cameraDirection: asString(s.cameraDirection ?? s.camera_direction, 'medium close-up'),
    cameraMovement: asString(s.cameraMovement ?? s.camera_movement, 'static'),
    charactersVisible: asStringArray(s.charactersVisible ?? s.characters_visible ?? s.characters),
    environment: asString(s.environment ?? s.location, 'indoor scene'),
    lighting: asString(s.lighting, 'natural cinematic lighting'),
    durationSeconds: Math.max(1, asNumber(s.durationSeconds ?? s.duration_seconds, 4)),
    requiresLipSync: asBool(
      s.requiresLipSync ?? s.requires_lip_sync,
      dialogue.trim().length > 0,
    ),
    ambientSound: asString(s.ambientSound ?? s.ambient_sound),
    musicDirection: asString(s.musicDirection ?? s.music_direction),
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
    location: asString(s.location, 'Interior'),
    characters: characters.length
      ? characters
      : [...new Set(shots.flatMap((shot) => shot.charactersVisible))],
    backgroundEnvironment: asString(
      s.backgroundEnvironment ?? s.background_environment ?? s.environment,
      asString(s.location, 'Everyday interior'),
    ),
    emotionalDirection: asString(s.emotionalDirection ?? s.emotional_direction, 'tense'),
    ambientSound: asString(s.ambientSound ?? s.ambient_sound),
    musicDirection: asString(s.musicDirection ?? s.music_direction),
    action: asString(s.action, 'Characters converse'),
    visualDescription: asString(s.visualDescription ?? s.visual_description, 'Cinematic 3D scene'),
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
      : {};

  const normalized = {
    episodeNumber: asNumber(obj.episodeNumber ?? obj.episode_number, 1),
    title: asString(obj.title, 'Untitled Episode'),
    synopsis: asString(obj.synopsis, 'Episode synopsis'),
    hook: asString(obj.hook, 'Opening hook'),
    ending: asString(obj.ending, 'Episode ending'),
    cliffhanger: asString(obj.cliffhanger),
    nextEpisodeSetup: asString(obj.nextEpisodeSetup ?? obj.next_episode_setup, 'Continues next'),
    keyPlotDevelopment: asString(
      obj.keyPlotDevelopment ?? obj.key_plot_development,
      'Conflict develops',
    ),
    emotionalBeats: asStringArray(obj.emotionalBeats ?? obj.emotional_beats),
    spokenWordCount: asNumber(obj.spokenWordCount ?? obj.spoken_word_count, spokenFromShots || 1),
    script: dialogueScript || 'Dialogue script',
    narrationText: asString(obj.narrationText ?? obj.narration_text),
    scenes,
    continuityChanges: {
      characterStateUpdates: Array.isArray(continuity.characterStateUpdates)
        ? continuity.characterStateUpdates
        : [],
      relationshipUpdates: Array.isArray(continuity.relationshipUpdates)
        ? continuity.relationshipUpdates
        : [],
      locationUpdates: Array.isArray(continuity.locationUpdates)
        ? continuity.locationUpdates
        : [],
      objectOwnershipUpdates: Array.isArray(continuity.objectOwnershipUpdates)
        ? continuity.objectOwnershipUpdates
        : [],
      newMysteries: asStringArray(continuity.newMysteries),
      resolvedMysteries: asStringArray(continuity.resolvedMysteries),
      knowledgeUpdates: Array.isArray(continuity.knowledgeUpdates)
        ? continuity.knowledgeUpdates
        : [],
    },
    memoryEvents: Array.isArray(obj.memoryEvents) ? obj.memoryEvents : [],
  };

  return dialogueEpisodeScriptPlanSchema.parse(normalized);
}
