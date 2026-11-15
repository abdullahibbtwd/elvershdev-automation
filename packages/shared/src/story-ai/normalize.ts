function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item))
      .join('; ');
    return joined.length ? joined : undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Flatten nested appearance-style objects into a readable string.
    const parts = Object.entries(record)
      .map(([key, val]) => {
        const text = asString(val);
        return text ? `${key}: ${text}` : null;
      })
      .filter((part): part is string => Boolean(part));
    if (parts.length) return parts.join('; ');
  }
  return undefined;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const text = asString(candidate);
    if (text) return text;
  }
  return undefined;
}

function unwrapStoryObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let obj = raw as Record<string, unknown>;
  for (const key of ['storyPackage', 'result', 'data', 'output', 'response', 'storyResult']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
      break;
    }
  }
  return obj;
}

function normalizeCharacter(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const appearanceObj =
    c.appearance && typeof c.appearance === 'object' && !Array.isArray(c.appearance)
      ? (c.appearance as Record<string, unknown>)
      : null;

  return {
    name: firstString(c.name, c.characterName, c.id) ?? 'Character',
    appearance:
      firstString(c.appearance, c.look, c.description, c.visualDescription) ??
      'Distinctive cinematic appearance',
    clothing:
      firstString(c.clothing, c.outfit, c.attire, appearanceObj?.clothing, appearanceObj?.outfit) ??
      'Simple practical clothing',
    ageRange:
      firstString(c.ageRange, c.age, c.age_range, appearanceObj?.ageRange, appearanceObj?.age) ??
      'adult',
    hair: firstString(c.hair, appearanceObj?.hair) ?? 'natural hair',
    distinctiveFeatures:
      firstString(
        c.distinctiveFeatures,
        c.features,
        c.distinctive_features,
        appearanceObj?.distinctiveFeatures,
        appearanceObj?.features,
      ) ?? 'memorable silhouette',
    consistencyNotes:
      firstString(c.consistencyNotes, c.notes, c.consistency_notes, c.consistency) ??
      'Keep appearance identical across scenes',
  };
}

/**
 * Coerce Gemini story JSON (which often drifts field names / nests appearance)
 * into the shape expected by `generatedStorySchema`.
 */
export function normalizeGeneratedStoryInput(raw: unknown): unknown {
  const obj = unwrapStoryObject(raw);
  if (!obj) return raw;

  const hashtagsRaw = obj.hashtags ?? obj.tags ?? obj.hashTags;
  const hashtags = Array.isArray(hashtagsRaw)
    ? hashtagsRaw.map((tag) => asString(tag)?.replace(/^#/, '')).filter((t): t is string => Boolean(t))
    : typeof hashtagsRaw === 'string'
      ? hashtagsRaw
          .split(/[\s,]+/)
          .map((tag) => tag.replace(/^#/, '').trim())
          .filter(Boolean)
      : ['story', 'shortfilm'];

  const charactersRaw = obj.characters ?? obj.cast ?? obj.characterProfiles;
  const characters = Array.isArray(charactersRaw)
    ? charactersRaw.map(normalizeCharacter).filter((c): c is Record<string, unknown> => Boolean(c))
    : [];

  return {
    title: firstString(obj.title, obj.name, obj.headline) ?? 'Untitled story',
    story:
      firstString(obj.story, obj.narrative, obj.fullStory, obj.body, obj.content, obj.scriptStory) ??
      firstString(obj.narrationScript, obj.narration, obj.voiceover) ??
      'A short cinematic story.',
    openingHook:
      firstString(obj.openingHook, obj.hook, obj.opening, obj.coldOpen) ??
      'Something unexpected begins.',
    narrationScript:
      firstString(obj.narrationScript, obj.narration, obj.voiceover, obj.voiceOver, obj.script) ??
      firstString(obj.story, obj.narrative, obj.fullStory) ??
      'The story unfolds.',
    closingMessage:
      firstString(obj.closingMessage, obj.closing, obj.outro, obj.takeaway, obj.ending) ??
      'The moment lingers.',
    description:
      firstString(obj.description, obj.summary, obj.caption, obj.socialDescription) ??
      firstString(obj.title) ??
      'A short cinematic story.',
    hashtags: hashtags.length ? hashtags : ['story', 'shortfilm'],
    characters,
  };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeScene(raw: unknown, index: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const visual =
    firstString(
      s.visualDescription,
      s.visual,
      s.visuals,
      s.shotDescription,
      s.description,
      s.sceneDescription,
    ) ?? 'Cinematic establishing shot';

  return {
    sceneNumber: asNumber(s.sceneNumber ?? s.number ?? s.index ?? s.scene) ?? index + 1,
    durationSeconds: asNumber(s.durationSeconds ?? s.duration ?? s.lengthSeconds ?? s.seconds) ?? 5,
    narration:
      firstString(s.narration, s.narrationScript, s.voiceover, s.dialogue, s.script) ??
      'The moment unfolds.',
    visualDescription: visual,
    imagePrompt:
      firstString(s.imagePrompt, s.image_prompt, s.stillPrompt, s.framePrompt) ?? visual,
    videoPrompt:
      firstString(s.videoPrompt, s.video_prompt, s.motionPrompt, s.clipPrompt) ??
      `${visual}. Subtle cinematic camera motion.`,
    cameraMovement:
      firstString(s.cameraMovement, s.camera, s.camera_move, s.shotType) ?? 'slow push-in',
    lighting:
      firstString(s.lighting, s.light, s.lightingSetup) ?? 'natural cinematic lighting',
    environment:
      firstString(s.environment, s.setting, s.location, s.backdrop) ??
      'atmospheric location matching the story',
    characterConsistencyInstructions:
      firstString(
        s.characterConsistencyInstructions,
        s.characterConsistency,
        s.consistencyInstructions,
        s.consistency,
      ) ?? 'Keep character appearance identical to the character bible',
  };
}

/**
 * Coerce Gemini scene-plan JSON into `generatedScenePlanSchema` shape.
 */
export function normalizeGeneratedScenePlanInput(raw: unknown): unknown {
  const obj = unwrapStoryObject(raw);
  if (!obj) return raw;

  const scenesRaw = obj.scenes ?? obj.shots ?? obj.timeline ?? obj.sceneList;
  const scenes = Array.isArray(scenesRaw)
    ? scenesRaw
        .map((scene, index) => normalizeScene(scene, index))
        .filter((scene): scene is Record<string, unknown> => Boolean(scene))
    : [];

  const charactersRaw = obj.characters ?? obj.cast ?? obj.characterProfiles;
  const characters = Array.isArray(charactersRaw)
    ? charactersRaw.map(normalizeCharacter).filter((c): c is Record<string, unknown> => Boolean(c))
    : [];

  const summed = scenes.reduce((sum, scene) => sum + (asNumber(scene.durationSeconds) ?? 0), 0);
  const totalDurationSeconds =
    asNumber(obj.totalDurationSeconds ?? obj.totalDuration ?? obj.durationSeconds ?? obj.duration) ??
    (summed > 0 ? summed : 30);

  return {
    totalDurationSeconds,
    scenes,
    characters,
  };
}
