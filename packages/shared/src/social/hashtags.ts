export type SocialHashtagPlatform =
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'YOUTUBE'
  | string;

export interface BuildViralHashtagsInput {
  platform: SocialHashtagPlatform;
  /** Existing story/AI tags without # */
  seedTags?: string[] | null;
  category?: string | null;
  theme?: string | null;
  title?: string | null;
  slotKind?: 'morning' | 'evening' | null;
  maxTags?: number;
}

const EVERGREEN = [
  'storytime',
  'shortstory',
  'motivation',
  'mindset',
  'lifelessons',
  'inspiration',
  'fyp',
  'viral',
  'reels',
  'shorts',
];

const MORNING_TAGS = [
  'motivation',
  'discipline',
  'ambition',
  'mindset',
  'hustle',
  'nevergiveup',
  'successmindset',
  'personalgrowth',
  'entrepreneur',
  'selfimprovement',
];

const EVENING_TAGS = [
  'emotional',
  'heartwarming',
  'kindness',
  'family',
  'hope',
  'humanity',
  'lifelessons',
  'touchingstories',
  'deepthoughts',
  'wholesome',
];

const PLATFORM_TAGS: Record<string, string[]> = {
  INSTAGRAM: ['reels', 'instareels', 'explorepage', 'viralreels', 'igreach'],
  TIKTOK: ['fyp', 'foryou', 'foryoupage', 'viral', 'storytok'],
  YOUTUBE: ['shorts', 'youtubeshorts', 'ytshorts', 'storyshorts'],
  FACEBOOK: ['fbshorts', 'facebookreels', 'viralvideo', 'shareable'],
};

const CATEGORY_TAGS: Record<string, string[]> = {
  'personal growth': ['personalgrowth', 'selfimprovement', 'growthmindset'],
  'human emotions': ['emotional', 'feelings', 'deepstory'],
  'unexpected twists': ['plotwist', 'unexpected', 'twistending'],
  'kindness and humanity': ['kindness', 'humanity', 'payitforward'],
  'life lessons': ['lifelessons', 'wisdom', 'perspective'],
  motivation: ['motivation', 'motivational', 'dailymotivation'],
  narrative: ['storytime', 'cinematic', 'shortfilm'],
};

function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  if (!cleaned || cleaned.length < 2 || cleaned.length > 40) return null;
  return cleaned;
}

function pushUnique(target: string[], tags: Array<string | null | undefined>, max: number) {
  for (const tag of tags) {
    if (target.length >= max) return;
    const normalized = tag ? normalizeTag(tag) : null;
    if (!normalized) continue;
    if (!target.includes(normalized)) target.push(normalized);
  }
}

/**
 * Build a platform-aware hashtag set for short-form storytelling posts.
 * Mix: seed/story tags + slot niche + category + platform discovery tags + evergreen.
 */
export function buildViralHashtags(input: BuildViralHashtagsInput): string[] {
  const platform = String(input.platform || '').toUpperCase();
  const max =
    input.maxTags ??
    (platform === 'INSTAGRAM' ? 15 : platform === 'TIKTOK' ? 6 : platform === 'YOUTUBE' ? 8 : 10);

  const tags: string[] = [];
  const seeds = (input.seedTags ?? []).map((t) => normalizeTag(t)).filter(Boolean) as string[];
  pushUnique(tags, seeds, max);

  if (input.slotKind === 'morning') pushUnique(tags, MORNING_TAGS, max);
  if (input.slotKind === 'evening') pushUnique(tags, EVENING_TAGS, max);

  const categoryKey = (input.category ?? '').toLowerCase().trim();
  if (categoryKey && CATEGORY_TAGS[categoryKey]) {
    pushUnique(tags, CATEGORY_TAGS[categoryKey], max);
  }

  if (input.theme) {
    pushUnique(tags, [input.theme, `${input.theme}story`], max);
  }

  pushUnique(tags, PLATFORM_TAGS[platform] ?? [], max);
  pushUnique(tags, EVERGREEN, max);

  // Light title keyword extraction (2–3 word-ish tokens)
  if (input.title) {
    const words = input.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !['that', 'with', 'from', 'this', 'your', 'have'].includes(w));
    pushUnique(tags, words.slice(0, 3), max);
  }

  return tags.slice(0, max);
}

/** Append hashtags to a caption if they are not already present. */
export function appendHashtagsToCaption(caption: string, hashtags: string[]): string {
  const base = caption.trim();
  const tags = hashtags
    .map((t) => normalizeTag(t))
    .filter((t): t is string => Boolean(t))
    .map((t) => `#${t}`);
  if (!tags.length) return base;

  const lower = base.toLowerCase();
  const missing = tags.filter((t) => !lower.includes(t.toLowerCase()));
  if (!missing.length) return base;
  return base ? `${base}\n\n${missing.join(' ')}` : missing.join(' ');
}
