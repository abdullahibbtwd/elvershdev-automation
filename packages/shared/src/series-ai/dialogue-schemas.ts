import { z } from 'zod';

export const DIALOGUE_SHOT_TYPES = [
  'close_up',
  'medium_close_up',
  'medium',
  'wide',
  'over_the_shoulder',
  'reaction',
  'two_shot',
  'insert',
] as const;

export const DIALOGUE_EMOTIONS = [
  'angry',
  'sad',
  'happy',
  'frightened',
  'suspicious',
  'calm',
  'excited',
  'whispering',
  'defensive',
  'hurt',
  'ashamed',
  'protective',
  'neutral',
] as const;

function nonEmptyStrings(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function filterNamedPairs(
  value: unknown,
  leftKey: string,
  rightKey: string,
): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const left = typeof row[leftKey] === 'string' ? row[leftKey].trim() : '';
      const right = typeof row[rightKey] === 'string' ? row[rightKey].trim() : '';
      return left && right ? { [leftKey]: left, [rightKey]: right } : null;
    })
    .filter(Boolean) as Array<Record<string, string>>;
}

function filterRelationshipPairs(
  value: unknown,
): Array<{ between: string[]; change: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const between = nonEmptyStrings(row.between).slice(0, 2);
      const change = typeof row.change === 'string' ? row.change.trim() : '';
      return between.length >= 2 && change ? { between, change } : null;
    })
    .filter(Boolean) as Array<{ between: string[]; change: string }>;
}

function filterKnowledgePairs(
  value: unknown,
): Array<{ character: string; learned: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const character = typeof row.character === 'string' ? row.character.trim() : '';
      const learned = nonEmptyStrings(row.learned);
      return character ? { character, learned } : null;
    })
    .filter(Boolean) as Array<{ character: string; learned: string[] }>;
}

export const dialogueShotPlanSchema = z.object({
  shotOrder: z.number().int().min(1),
  shotType: z.enum(DIALOGUE_SHOT_TYPES).default('medium_close_up'),
  /**
   * Speaking character for dialogue shots.
   * May be empty for pure reaction / listening / insert shots (no spoken line).
   */
  speaker: z.string().max(100).default(''),
  /** Empty for pure reaction / listening shots. */
  dialogue: z.string().max(2000).default(''),
  listeners: z.array(z.string().min(1).max(100)).max(8).default([]),
  emotion: z.string().min(1).max(120).default('neutral'),
  facialExpression: z.string().min(1).max(300).default('natural expression'),
  bodyLanguage: z.string().min(1).max(300).default('natural posture'),
  cameraDirection: z.string().min(1).max(300).default('medium close-up'),
  cameraMovement: z.string().max(200).optional().default('static'),
  charactersVisible: z.preprocess(
    (value) => nonEmptyStrings(value, ['Character']),
    z.array(z.string().min(1).max(100)).min(1).max(8),
  ),
  environment: z.string().min(1).max(500).default('indoor scene'),
  lighting: z.string().max(300).optional().default('natural cinematic lighting'),
  durationSeconds: z.number().min(1).max(30).default(4),
  requiresLipSync: z.boolean().default(true),
  ambientSound: z.string().max(300).optional().default(''),
  musicDirection: z.string().max(300).optional().default(''),
  /**
   * Physical story objects that MUST be visible in this shot
   * (phone, ring, letter, keys, gift, photo, etc.). Empty only when none matter.
   */
  keyProps: z
    .preprocess((value) => nonEmptyStrings(value), z.array(z.string().min(1).max(80)).max(12))
    .optional()
    .default([]),
});

export type DialogueShotPlan = z.infer<typeof dialogueShotPlanSchema>;

export const dialogueScenePlanSchema = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().min(3).max(60),
  location: z.string().min(1).max(500),
  characters: z.array(z.string().min(1).max(100)).min(1).max(8),
  backgroundEnvironment: z.string().min(1).max(800),
  emotionalDirection: z.string().min(1).max(400),
  ambientSound: z.string().max(400).optional().default(''),
  musicDirection: z.string().max(400).optional().default(''),
  /** Legacy free-text fields kept for adapter / continuity digests. */
  action: z.string().min(1).max(2000),
  visualDescription: z.string().min(1).max(2000),
  narration: z.string().max(2000).optional().default(''),
  shots: z.array(dialogueShotPlanSchema).min(1).max(20),
});

export type DialogueScenePlan = z.infer<typeof dialogueScenePlanSchema>;

export const dialogueEpisodeScriptPlanSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1),
  hook: z.string().min(1),
  ending: z.string().min(1),
  cliffhanger: z.string().optional().default(''),
  nextEpisodeSetup: z.string().min(1),
  keyPlotDevelopment: z.string().min(1),
  emotionalBeats: z.array(z.string().min(1)).default([]),
  spokenWordCount: z.number().int().min(1),
  /** Full readable script assembled from dialogue lines. */
  script: z.string().min(1),
  /**
   * Narration is optional and discouraged. Empty string when dialogue-driven.
   * Kept for continuity with SeriesEpisode.narrationText column.
   */
  narrationText: z.string().default(''),
  scenes: z.array(dialogueScenePlanSchema).min(2).max(10),
  continuityChanges: z.object({
    characterStateUpdates: z.preprocess(
      (value) => filterNamedPairs(value, 'character', 'change'),
      z.array(z.object({ character: z.string().min(1), change: z.string().min(1) })),
    ),
    relationshipUpdates: z.preprocess(
      (value) => filterRelationshipPairs(value),
      z.array(
        z.object({
          between: z.array(z.string().min(1)).min(2).max(2),
          change: z.string().min(1),
        }),
      ),
    ),
    locationUpdates: z.preprocess(
      (value) => filterNamedPairs(value, 'character', 'location'),
      z.array(z.object({ character: z.string().min(1), location: z.string().min(1) })),
    ),
    objectOwnershipUpdates: z.preprocess(
      (value) => filterNamedPairs(value, 'object', 'owner'),
      z.array(z.object({ object: z.string().min(1), owner: z.string().min(1) })),
    ),
    newMysteries: z.preprocess(
      (value) => nonEmptyStrings(value),
      z.array(z.string().min(1)),
    ),
    resolvedMysteries: z.preprocess(
      (value) => nonEmptyStrings(value),
      z.array(z.string().min(1)),
    ),
    knowledgeUpdates: z.preprocess(
      (value) => filterKnowledgePairs(value),
      z.array(
        z.object({
          character: z.string().min(1),
          learned: z.array(z.string().min(1)).default([]),
        }),
      ),
    ),
  }),
  memoryEvents: z
    .array(
      z.object({
        eventType: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        affectedCharacters: z.array(z.string().min(1)).default([]),
        importance: z.number().int().min(1).max(10).default(5),
        audienceKnows: z.boolean().default(true),
        knownByCharacters: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
});

export type DialogueEpisodeScriptPlan = z.infer<typeof dialogueEpisodeScriptPlanSchema>;

export function flattenDialogueLines(plan: DialogueEpisodeScriptPlan): Array<{
  sceneNumber: number;
  shotOrder: number;
  speaker: string;
  dialogue: string;
  emotion: string;
  durationSeconds: number;
  requiresLipSync: boolean;
}> {
  const lines: Array<{
    sceneNumber: number;
    shotOrder: number;
    speaker: string;
    dialogue: string;
    emotion: string;
    durationSeconds: number;
    requiresLipSync: boolean;
  }> = [];
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      if (!shot.dialogue.trim()) continue;
      lines.push({
        sceneNumber: scene.sceneNumber,
        shotOrder: shot.shotOrder,
        speaker: shot.speaker,
        dialogue: shot.dialogue.trim(),
        emotion: shot.emotion,
        durationSeconds: shot.durationSeconds,
        requiresLipSync: shot.requiresLipSync,
      });
    }
  }
  return lines;
}

export function validateDialogueSpeakers(
  plan: DialogueEpisodeScriptPlan,
  characterNames: string[],
): string[] {
  const known = new Set(characterNames.map((n) => n.toLowerCase()));
  const errors: string[] = [];
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      if (shot.dialogue.trim() && !known.has(shot.speaker.toLowerCase())) {
        errors.push(
          `Scene ${scene.sceneNumber} shot ${shot.shotOrder}: unknown speaker "${shot.speaker}"`,
        );
      }
      if (shot.dialogue.trim() && shot.requiresLipSync === false) {
        errors.push(
          `Scene ${scene.sceneNumber} shot ${shot.shotOrder}: speaking shot must require lip-sync`,
        );
      }
    }
  }
  const speaking = flattenDialogueLines(plan);
  if (speaking.length < 2) {
    errors.push('Episode must contain at least two spoken dialogue lines');
  }
  const speakers = new Set(speaking.map((l) => l.speaker.toLowerCase()));
  if (speakers.size < 2) {
    errors.push('Episode must have at least two distinct speaking characters');
  }
  return errors;
}
