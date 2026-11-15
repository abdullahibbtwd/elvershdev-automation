function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item))
      .join('; ');
    return joined.length ? joined : undefined;
  }
  if (value && typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>)
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

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let obj = raw as Record<string, unknown>;
  for (const key of ['result', 'data', 'output', 'response', 'visualAnalysis', 'analysis']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
      break;
    }
  }
  return obj;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = asString(value);
    return single ? [single] : [];
  }
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

function normalizeAppearance(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  return {
    name: firstString(a.name, a.characterName) ?? 'Character',
    appearance:
      firstString(a.appearance, a.look, a.description) ?? 'Distinctive cinematic appearance',
    clothing: firstString(a.clothing, a.outfit) ?? 'Simple practical clothing',
    ageRange: firstString(a.ageRange, a.age),
    facialExpression: firstString(a.facialExpression, a.expression, a.emotion) ?? 'neutral',
    bodyPosture: firstString(a.bodyPosture, a.posture, a.pose) ?? 'natural stance',
    physicalAction: firstString(a.physicalAction, a.action, a.activity) ?? 'standing',
  };
}

function normalizeCharacter(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const description =
    firstString(c.description, c.summary, c.appearance, c.canonicalVisualDescription) ??
    'Cinematic character';
  return {
    name: firstString(c.name, c.characterName) ?? 'Character',
    description,
    approximateAge: firstString(c.approximateAge, c.age, c.ageRange) ?? 'adult',
    genderPresentation: firstString(c.genderPresentation, c.gender),
    skinTone: firstString(c.skinTone, c.skin),
    facialFeatures: firstString(c.facialFeatures, c.face, c.features) ?? 'distinctive face',
    hairstyle: firstString(c.hairstyle, c.hairStyle, c.hair) ?? 'natural hair',
    hairColor: firstString(c.hairColor, c.hair_colour) ?? 'natural',
    bodyBuild: firstString(c.bodyBuild, c.build, c.physique),
    clothing: firstString(c.clothing, c.outfit, c.attire) ?? 'practical clothing',
    accessories: firstString(c.accessories),
    distinguishingCharacteristics:
      firstString(c.distinguishingCharacteristics, c.distinctiveFeatures, c.features) ??
      'memorable silhouette',
    visualConsistencyInstructions:
      firstString(c.visualConsistencyInstructions, c.consistencyNotes, c.consistency) ??
      'Keep appearance identical across scenes',
    canonicalVisualDescription:
      firstString(c.canonicalVisualDescription, c.canonicalDescription, description) ?? description,
  };
}

function normalizeScene(raw: unknown, index: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const appearancesRaw = s.characterAppearances ?? s.charactersInScene ?? s.cast;
  const characterAppearances = Array.isArray(appearancesRaw)
    ? appearancesRaw
        .map(normalizeAppearance)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];

  const location = firstString(s.location, s.setting, s.place) ?? 'story location';
  const environment =
    firstString(s.environment, s.surroundings, s.backdrop) ?? location;
  const lighting = firstString(s.lighting, s.light, s.lightingSetup) ?? 'cinematic lighting';
  const imagePrompt =
    firstString(s.imagePrompt, s.prompt, s.visualPrompt) ??
    `${location}. ${environment}. ${lighting}. Photoreal cinematic still.`;

  return {
    sceneNumber: asNumber(s.sceneNumber ?? s.number ?? s.index) ?? index + 1,
    mainSubject: firstString(s.mainSubject, s.subject, s.focus) ?? 'main subject of the scene',
    charactersPresent: stringArray(s.charactersPresent ?? s.characters),
    characterAppearances,
    location,
    environment,
    timeOfDay: firstString(s.timeOfDay, s.time, s.daypart) ?? 'day',
    weather: firstString(s.weather, s.climate) ?? 'clear',
    lighting,
    cameraAngle: firstString(s.cameraAngle, s.angle) ?? 'eye-level',
    cameraDistance: firstString(s.cameraDistance, s.distance, s.shotSize) ?? 'medium shot',
    composition: firstString(s.composition, s.framing) ?? 'balanced cinematic framing',
    backgroundDetails:
      firstString(s.backgroundDetails, s.background, s.bg) ?? 'supporting environmental detail',
    emotionalAtmosphere:
      firstString(s.emotionalAtmosphere, s.atmosphere, s.mood) ?? 'focused',
    visualStyleNotes:
      firstString(s.visualStyleNotes, s.styleNotes, s.style) ?? 'photoreal cinematic',
    aspectRatio: firstString(s.aspectRatio, s.ratio) ?? '9:16',
    imagePrompt,
    negativePrompt:
      firstString(s.negativePrompt, s.negatives) ??
      'cartoon, illustration, anime, deformed hands, extra limbs, watermark, text',
  };
}

export function normalizeVisualAnalysisBatchInput(raw: unknown): unknown {
  const obj = unwrap(raw);
  if (!obj) return raw;

  const charactersRaw = obj.characters ?? obj.cast ?? obj.characterBible;
  const scenesRaw = obj.scenes ?? obj.shots ?? obj.frames;

  const characters = Array.isArray(charactersRaw)
    ? charactersRaw
        .map(normalizeCharacter)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const scenes = Array.isArray(scenesRaw)
    ? scenesRaw
        .map((scene, index) => normalizeScene(scene, index))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];

  return { characters, scenes };
}
