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
  for (const key of ['result', 'data', 'output', 'response', 'motionAnalysis', 'analysis']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
      break;
    }
  }
  return obj;
}

function normalizeScene(raw: unknown, index: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const cameraMovement =
    firstString(s.cameraMovement, s.camera, s.camera_move) ?? 'slow cinematic push-in';
  const characterMovement =
    firstString(s.characterMovement, s.subjectMotion, s.movement) ?? 'subtle natural motion';
  const motionPrompt =
    firstString(s.motionPrompt, s.prompt, s.videoPrompt) ??
    `${cameraMovement}. ${characterMovement}. Preserve identity and wardrobe.`;

  return {
    sceneNumber: asNumber(s.sceneNumber ?? s.number ?? s.index) ?? index + 1,
    mainSubject: firstString(s.mainSubject, s.subject, s.focus) ?? 'main subject',
    characterMovement,
    facialExpressions:
      firstString(s.facialExpressions, s.expression, s.face) ?? 'subtle natural expression',
    bodyMovement: firstString(s.bodyMovement, s.body, s.poseMotion) ?? 'restrained natural body motion',
    environmentalMovement:
      firstString(s.environmentalMovement, s.environmentMotion, s.ambianceMotion) ??
      'gentle environmental motion',
    cameraMovement,
    cameraAngle: firstString(s.cameraAngle, s.angle) ?? 'eye-level',
    cameraDistance: firstString(s.cameraDistance, s.distance) ?? 'medium shot',
    sceneAtmosphere: firstString(s.sceneAtmosphere, s.atmosphere, s.mood) ?? 'cinematic',
    lightingContinuity:
      firstString(s.lightingContinuity, s.lighting, s.light) ?? 'preserve first-frame lighting',
    movementSpeed: firstString(s.movementSpeed, s.speed) ?? 'gentle',
    emotionalIntention:
      firstString(s.emotionalIntention, s.emotion, s.intention) ?? 'focused',
    startFrameConsistency:
      firstString(s.startFrameConsistency, s.startConsistency) ??
      'match first frame identity and composition',
    endFrameComposition:
      firstString(s.endFrameComposition, s.endComposition) ??
      'end on a clean readable composition',
    motionPrompt: motionPrompt.slice(0, 2500),
    negativePrompt:
      firstString(s.negativePrompt, s.negatives) ??
      'morphing faces, extra limbs, teleporting, cartoon physics, text overlays, watermark',
  };
}

export function normalizeMotionAnalysisBatchInput(raw: unknown): unknown {
  const obj = unwrap(raw);
  if (!obj) return raw;
  const scenesRaw = obj.scenes ?? obj.shots ?? obj.clips;
  const scenes = Array.isArray(scenesRaw)
    ? scenesRaw
        .map((scene, index) => normalizeScene(scene, index))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return { scenes };
}
