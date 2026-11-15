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
      .join(' ');
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
  for (const key of ['result', 'data', 'output', 'response', 'narration', 'script']) {
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
  const text =
    firstString(s.text, s.narration, s.voiceover, s.script, s.spokenText) ??
    'The moment continues.';
  const sceneNumber = asNumber(s.sceneNumber ?? s.number ?? s.index) ?? index + 1;
  const sequence = asNumber(s.sequence ?? s.order) ?? sceneNumber;
  const estimated =
    asNumber(s.estimatedDurationSeconds ?? s.durationSeconds ?? s.duration ?? s.seconds) ?? 5;

  return {
    sceneId: firstString(s.sceneId, s.id),
    sceneNumber,
    text,
    emotionalTone: firstString(s.emotionalTone, s.emotion, s.tone) ?? 'focused',
    speakingStyle:
      firstString(s.speakingStyle, s.style, s.deliveryStyle) ?? 'calm and measured',
    deliveryInstructions: firstString(s.deliveryInstructions, s.delivery, s.notes) ?? '',
    pronunciationGuidance:
      firstString(s.pronunciationGuidance, s.pronunciation, s.phonetics) ?? '',
    estimatedDurationSeconds: Math.min(600, Math.max(0.5, estimated)),
    sequence,
  };
}

export function normalizePlannedNarrationScriptInput(raw: unknown): unknown {
  const obj = unwrap(raw);
  if (!obj) return raw;

  const scenesRaw = obj.scenes ?? obj.segments ?? obj.lines;
  const scenes = Array.isArray(scenesRaw)
    ? scenesRaw
        .map((scene, index) => normalizeScene(scene, index))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];

  const fullText =
    firstString(obj.fullText, obj.full_script, obj.script, obj.narration) ??
    scenes
      .map((scene) => asString(scene.text))
      .filter((text): text is string => Boolean(text))
      .join('\n\n');

  return {
    fullText: fullText || 'Narration.',
    notes: firstString(obj.notes, obj.commentary) ?? '',
    scenes,
  };
}
