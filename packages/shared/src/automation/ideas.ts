import { ideaFingerprint, isNearDuplicateIdea } from './fingerprint';

export interface ContentIdeaSeed {
  title: string;
  summary: string;
  category: string;
  genre: string;
  theme: string;
  topic: string;
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

  let attempt = 0;
  while (ideas.length < input.count && attempt < input.count * 12) {
    const category = selectCategory(input, attempt);
    const genre =
      input.genres[attempt % Math.max(input.genres.length, 1)] || 'Cinematic storytelling';
    const theme =
      input.themes[attempt % Math.max(input.themes.length, 1)] ||
      ['resilience', 'ambition', 'belonging', 'redemption'][attempt % 4];
    const template = IDEA_TEMPLATES[attempt % IDEA_TEMPLATES.length];
    const seed = template({
      niche: input.niche,
      audience: input.audience,
      category,
      genre,
      theme,
      tone: input.tone,
      exclusions: input.exclusions,
      slotIndex: ideas.length,
      daySalt: `${input.daySalt}:${attempt}`,
    });

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
): string {
  const categories = input.categories.length ? input.categories : ['Narrative'];
  const preferredNames = new Set(
    (input.preferredCategories ?? []).map((category) => category.toLowerCase()),
  );
  const deprioritizedNames = new Set(
    (input.deprioritizedCategories ?? []).map((category) => category.toLowerCase()),
  );
  const preferred = categories.filter((category) => preferredNames.has(category.toLowerCase()));
  const regular = categories.filter(
    (category) =>
      !preferredNames.has(category.toLowerCase()) &&
      !deprioritizedNames.has(category.toLowerCase()),
  );
  const nonPreferred = categories.filter((category) => !preferredNames.has(category.toLowerCase()));

  // Three out of five slots favor preferred categories. The remaining slots
  // continue rotating through every other category so diversity is preserved.
  if (preferred.length && index % 5 < 3) {
    return preferred[Math.floor(index / 5 + (index % 5)) % preferred.length]!;
  }
  if (regular.length && index % 5 === 3) {
    return regular[Math.floor(index / 5) % regular.length]!;
  }
  const diversityPool = nonPreferred.length ? nonPreferred : categories;
  return diversityPool[Math.floor(index / 5 + (index % 5)) % diversityPool.length]!;
}

export function fingerprintIdea(idea: ContentIdeaSeed): string {
  return ideaFingerprint({
    title: idea.title,
    summary: idea.summary,
    category: idea.category,
    theme: idea.theme,
  });
}
