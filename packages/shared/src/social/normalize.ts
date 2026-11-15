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
  return undefined;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const text = asString(candidate);
    if (text) return text;
  }
  return undefined;
}

function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let obj = raw as Record<string, unknown>;
  for (const key of ['result', 'data', 'output', 'response', 'suggestion']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
      break;
    }
  }
  return obj;
}

function normalizeHashtag(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  return text.replace(/^#+/, '').trim() || null;
}

export function normalizeCaptionSuggestionResultInput(raw: unknown): unknown {
  const obj = unwrap(raw);
  if (!obj) return raw;

  const hashtagsRaw = obj.hashtags ?? obj.tags ?? obj.tagList;
  const hashtags = Array.isArray(hashtagsRaw)
    ? hashtagsRaw
        .map(normalizeHashtag)
        .filter((tag): tag is string => Boolean(tag))
        .slice(0, 30)
    : [];

  const caption =
    firstString(obj.caption, obj.text, obj.copy, obj.post) ??
    firstString(obj.title, obj.description) ??
    'New story video';

  return {
    title: firstString(obj.title, obj.headline)?.slice(0, 100),
    caption: caption.slice(0, 2200),
    description: firstString(obj.description, obj.longDescription)?.slice(0, 5000),
    hashtags,
  };
}
