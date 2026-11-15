function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic non-cryptographic fingerprint safe for browser + Node. */
export function ideaFingerprint(parts: {
  title: string;
  summary: string;
  category?: string | null;
  theme?: string | null;
}): string {
  const payload = [
    normalizeText(parts.title),
    normalizeText(parts.summary).slice(0, 240),
    normalizeText(parts.category ?? ''),
    normalizeText(parts.theme ?? ''),
  ].join('|');

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Mix again for better distribution
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}_${payload.length}`;
}

export function isNearDuplicateIdea(
  candidate: { title: string; summary: string },
  existing: Array<{ title: string; summary: string }>,
  threshold = 0.72,
): boolean {
  const candidateTokens = new Set(
    normalizeText(`${candidate.title} ${candidate.summary}`).split(' ').filter(Boolean),
  );
  if (candidateTokens.size === 0) return false;

  for (const item of existing) {
    const tokens = new Set(
      normalizeText(`${item.title} ${item.summary}`).split(' ').filter(Boolean),
    );
    if (tokens.size === 0) continue;
    let overlap = 0;
    for (const token of candidateTokens) {
      if (tokens.has(token)) overlap += 1;
    }
    const score = overlap / Math.max(candidateTokens.size, tokens.size);
    if (score >= threshold) {
      return true;
    }
  }
  return false;
}
