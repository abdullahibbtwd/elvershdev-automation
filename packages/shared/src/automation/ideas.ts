import { ideaFingerprint, isNearDuplicateIdea } from './fingerprint';
import { resolveDailySlot, type DailySlotProfile } from './slots';

export interface ContentIdeaSeed {
  title: string;
  summary: string;
  category: string;
  genre: string;
  theme: string;
  topic: string;
  /** morning | evening when generated for a daily slot */
  slotKind?: string;
  slotLabel?: string;
}

const IDEA_TEMPLATES: Array<(ctx: IdeaContext) => ContentIdeaSeed> = [
  (ctx) => ({
    title: `The quiet decision that reshaped a ${ctx.niche} journey`,
    summary: `A cinematic story about someone in ${ctx.audience} who makes one overlooked choice that changes their path in ${ctx.niche}.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'transformation',
    topic: `Quiet decision in ${ctx.niche} that transforms destiny`,
  }),
  (ctx) => ({
    title: `When ${ctx.theme || 'courage'} arrived one night too late`,
    summary: `An emotional ${ctx.genre.toLowerCase()} tale for ${ctx.audience}, exploring delayed bravery inside the world of ${ctx.niche}.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'courage',
    topic: `Delayed courage overnight in ${ctx.niche}`,
  }),
  (ctx) => ({
    title: `The mentor who refused to be remembered`,
    summary: `A character-driven narrative where a mentor guides ${ctx.audience} through ${ctx.niche} without seeking credit.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'mentorship',
    topic: `Anonymous mentor shaping ${ctx.niche} lives`,
  }),
  (ctx) => ({
    title: `A promise kept after everyone left`,
    summary: `A ${ctx.tone.toLowerCase()} story about loyalty under pressure, set against ${ctx.niche} stakes for ${ctx.audience}.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'loyalty',
    topic: `Keeping a promise after abandonment in ${ctx.niche}`,
  }),
  (ctx) => ({
    title: `The map that only worked backwards`,
    summary: `A unique plot where progress in ${ctx.niche} requires revisiting failures, told for ${ctx.audience}.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'reflection',
    topic: `Backwards map of failures unlocking ${ctx.niche} success`,
  }),
  (ctx) => ({
    title: `Letters never sent from a rising star`,
    summary: `Epistolary-inspired cinematic storytelling about unspoken words in ${ctx.niche}, aimed at ${ctx.audience}.`,
    category: ctx.category,
    genre: ctx.genre,
    theme: ctx.theme || 'unspoken truth',
    topic: `Unsent letters from a rising ${ctx.niche} figure`,
  }),
];

export interface IdeaContext {
  niche: string;
  audience: string;
  category: string;
  genre: string;
  theme: string;
  tone: string;
  exclusions: string[];
  slotIndex: number;
  daySalt: string;
}

export function generateUniqueContentIdeas(input: {
  count: number;
  niche: string;
  audience: string;
  categories: string[];
  preferredCategories?: string[];
  deprioritizedCategories?: string[];
  genres: string[];
  themes: string[];
  tone: string;
  exclusions: string[];
  daySalt: string;
  /** Absolute slot index for the first idea (existing plans length). */
  startingSlotIndex?: number;
  dailySlots?: DailySlotProfile[];
  recent: Array<{ title: string; summary: string; fingerprint?: string }>;
}): ContentIdeaSeed[] {
  const ideas: ContentIdeaSeed[] = [];
  const recentFingerprints = new Set(
    input.recent.map((item) => item.fingerprint).filter(Boolean) as string[],
  );
  const recentForDup = input.recent.map((item) => ({
    title: item.title,
    summary: item.summary,
  }));
  const startingSlotIndex = input.startingSlotIndex ?? 0;

  let attempt = 0;
  while (ideas.length < input.count && attempt < input.count * 12) {
    const absoluteSlot = startingSlotIndex + ideas.length;
    const slot = resolveDailySlot(absoluteSlot, input.dailySlots);
    const category = selectCategory(
      {
        ...input,
        preferredCategories: [
          ...slot.preferredCategories,
          ...(input.preferredCategories ?? []),
        ],
      },
      attempt,
      slot,
    );
    const genre =
      input.genres[attempt % Math.max(input.genres.length, 1)] || 'Cinematic storytelling';
    const themePool = [
      ...slot.preferredThemes.filter((t) =>
        input.themes.length ? input.themes.some((x) => x.toLowerCase() === t.toLowerCase()) : true,
      ),
      ...input.themes,
      ...slot.preferredThemes,
    ];
    const theme =
      themePool[attempt % Math.max(themePool.length, 1)] ||
      ['resilience', 'ambition', 'belonging', 'redemption'][attempt % 4];
    const template = IDEA_TEMPLATES[attempt % IDEA_TEMPLATES.length];
    const seed = template({
      niche: input.niche,
      audience: input.audience,
      category,
      genre,
      theme,
      tone: slot.toneHint || input.tone,
      exclusions: input.exclusions,
      slotIndex: absoluteSlot,
      daySalt: `${input.daySalt}:${attempt}`,
    });

    seed.slotKind = slot.kind;
    seed.slotLabel = slot.label;

    // Slot-specific uniqueness salt to avoid identical daily titles
    seed.title = `${seed.title} (${input.daySalt.slice(-4)}-${ideas.length + 1})`;
    seed.topic = `${seed.topic} [${input.daySalt}:${ideas.length}:${attempt}]`;

    const blocked = input.exclusions.some((exclusion) => {
      const needle = exclusion.toLowerCase().trim();
      if (!needle) return false;
      return (
        seed.title.toLowerCase().includes(needle) ||
        seed.summary.toLowerCase().includes(needle) ||
        seed.topic.toLowerCase().includes(needle)
      );
    });
    if (blocked) {
      attempt += 1;
      continue;
    }

    const fingerprint = ideaFingerprint({
      title: seed.title,
      summary: seed.summary,
      category: seed.category,
      theme: seed.theme,
    });
    if (recentFingerprints.has(fingerprint)) {
      attempt += 1;
      continue;
    }
    if (isNearDuplicateIdea(seed, [...recentForDup, ...ideas])) {
      attempt += 1;
      continue;
    }

    ideas.push(seed);
    recentFingerprints.add(fingerprint);
    attempt += 1;
  }

  return ideas;
}

function selectCategory(
  input: {
    categories: string[];
    preferredCategories?: string[];
    deprioritizedCategories?: string[];
  },
  index: number,
  slot?: DailySlotProfile,
): string {
  const categories = input.categories.length ? input.categories : ['Narrative'];
  const preferredNames = new Set(
    (input.preferredCategories ?? []).map((category) => category.toLowerCase()),
  );
  const deprioritizedNames = new Set(
    (input.deprioritizedCategories ?? []).map((category) => category.toLowerCase()),
  );

  // Prefer slot categories that exist in the user's configured list; otherwise use slot list as-is.
  const slotPreferred = (slot?.preferredCategories ?? [])
    .map((name) => categories.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name)
    .filter(Boolean);
  const preferredFromConfig = categories.filter((category) =>
    preferredNames.has(category.toLowerCase()),
  );
  const preferred = [...slotPreferred, ...preferredFromConfig].filter(
    (category, i, arr) => arr.findIndex((x) => x.toLowerCase() === category.toLowerCase()) === i,
  );

  const regular = categories.filter(
    (category) =>
      !preferred.some((p) => p.toLowerCase() === category.toLowerCase()) &&
      !deprioritizedNames.has(category.toLowerCase()),
  );
  const nonPreferred = categories.filter(
    (category) => !preferred.some((p) => p.toLowerCase() === category.toLowerCase()),
  );

  // Strongly favor the daily slot's preferred categories, with occasional diversity.
  if (preferred.length && index % 4 < 3) {
    return preferred[Math.floor(index / 4 + (index % 4)) % preferred.length]!;
  }
  if (regular.length && index % 4 === 3) {
    return regular[Math.floor(index / 4) % regular.length]!;
  }
  const diversityPool = nonPreferred.length ? nonPreferred : categories;
  return diversityPool[Math.floor(index / 4 + (index % 4)) % diversityPool.length]!;
}

export function fingerprintIdea(idea: ContentIdeaSeed): string {
  return ideaFingerprint({
    title: idea.title,
    summary: idea.summary,
    category: idea.category,
    theme: idea.theme,
  });
}
