import { z } from 'zod';

/** Supported Series Studio genres (multi-select). */
export const SERIES_GENRE_OPTIONS = [
  'Family drama',
  'Mystery thriller',
  'Romantic drama',
  'Crime drama',
  'Social drama',
  'Revenge',
  'Suspense',
  'Betrayal',
  'Supernatural',
  'Cinematic drama',
] as const;

export const SERIES_THEME_OPTIONS = [
  'Jealousy',
  'Greed',
  'Family conflict',
  'Favouritism',
  'Inheritance disputes',
  'Manipulation',
  'Hidden secrets',
  'Deception',
  'Power struggles',
  'Sibling rivalry',
] as const;

export const SERIES_CLIFFHANGER_INTENSITY = ['low', 'medium', 'high'] as const;
export const SERIES_NARRATION_PREFERENCE = ['avoid', 'allowed', 'required'] as const;
export const SERIES_DIALOGUE_DENSITY = ['low', 'medium', 'high'] as const;
export const SERIES_COST_MODE_OPTIONS = ['quality', 'balanced', 'economy'] as const;

/** Locked Series Studio look: stylized cartoon (not photoreal humans). */
export const SERIES_CARTOON_VISUAL_STYLE =
  'Stylized cinematic 3D cartoon animation (Pixar/DreamWorks-like). Expressive cartoon faces, clean readable designs, consistent character model sheets, vibrant but natural lighting, emotional acting. NOT photorealistic live-action humans. NOT low-quality chibi or scribble doodles.';

/** Product default creative direction for Series Studio dialogue-driven lanes. */
export const SERIES_DIALOGUE_CREATIVE_DEFAULTS = {
  dialogueDrivenStorytelling: true,
  narrationPreference: 'avoid' as const,
  dialogueDensity: 'high' as const,
  lipSyncRequired: true,
  subtitlePreference: true,
  /** YouTube Shorts / TikTok vertical — locked for Series Studio. */
  aspectRatio: '9:16',
  // Duration lives on SeriesAutomationConfig / lane columns — do not bake 60s/10eps
  // into dialogue creative defaults or Plan Movie will ignore Production settings.
  maxClipDurationSeconds: 15,
  productionFormat: 'episodic' as const,
  language: 'en',
  /** balanced = lip-sync on speech + FFmpeg for reactions/env; avoid Hailuo on dialogue path. */
  costMode: 'balanced' as const,
  reuseCharacterReferences: true,
  preferFfmpegForReactions: true,
  maxLipSyncSecondsPerEpisode: 24,
  visualStyle: SERIES_CARTOON_VISUAL_STYLE,
  cinematicShotStyle:
    'Cinematic cartoon shot-reverse-shot conversations with close-ups, medium shots, over-the-shoulder angles, and reaction shots. Always frame for 9:16 vertical.',
  characterAnimationStyle:
    'Cartoon mouth sync to speech, big readable facial expressions, clear gestures and body language during conversation.',
  dialogueStyle:
    'Natural, simple everyday conversations like: “Who’s Maya?” / “It’s not what you think.” Characters speak to each other; never use a narrator.',
  characterVoiceStyle: 'Distinct consistent voices per character; emotional but clear speech.',
  accentPreference: 'Clear everyday spoken English; regional accent only when character canon requires it.',
  storytellingRules: [
    'Invent a NEW original movie from selected genres/themes — never recycle stock inheritance/bakery plots.',
    'Write a short understandable movie: small cast (2–4), one clear conflict, emotional escalation, earned twist/reveal, satisfying ending.',
    'Plain modern English only. A stranger must understand the story after one read.',
    'Structure connected episode parts (e.g. Part 1 misunderstanding → Part 2 truth), scaled to the configured story duration (60s to ~10 min).',
    'Design for Grok: simple actions, clear facial emotions, short dialogue lines, ≤15s filmable beats.',
    'If the plot needs a phone, ring, letter, keys, gift, photo, or other object, show that object on screen (hands holding it, insert close-up) — never only talk about it.',
  ],
  contentExclusions: [
    'Narrator-led slideshow storytelling',
    'Unrelated cinematic B-roll over narration',
    'Silent characters while a narrator explains everything',
    'Confusing purple-prose dialogue or multi-mystery plots that are hard to follow in under a minute',
    'Plot-critical props that are only mentioned in dialogue and never shown on camera',
  ],
  genres: ['Family drama', 'Social drama'],
  themes: [
    'Family conflict',
    'Sibling rivalry',
    'Favouritism',
    'Jealousy',
    'Betrayal',
    'Discrimination',
  ],
} as const;

/** Treat blank form strings as omitted optional fields (UI often sends ""). */
const optionalText = (max: number, min = 0) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }, min > 0 ? z.string().min(min).max(max).optional() : z.string().max(max).optional());

export const seriesCreativeSettingsSchema = z.object({
  genres: z.array(z.string().min(1).max(80)).max(12).default([]),
  themes: z.array(z.string().min(1).max(120)).max(20).default([]),
  excludedThemes: z.array(z.string().min(1).max(120)).max(20).default([]),
  targetAudience: optionalText(200),
  language: optionalText(10, 2),
  tone: optionalText(100),
  dialogueStyle: optionalText(300),
  narrativeTone: optionalText(300),
  storytellingRules: z.array(z.string().min(1).max(400)).max(20).default([]),
  contentExclusions: z.array(z.string().min(1).max(400)).max(20).default([]),
  characterPreferences: optionalText(2000),
  endingPreferences: optionalText(2000),
  cliffhangerIntensity: z.enum(SERIES_CLIFFHANGER_INTENSITY).optional(),
  visualStyle: optionalText(2000),
  characterConsistencyRequired: z.boolean().optional(),
  narrationPreferences: optionalText(2000),
  /**
   * Individual episode duration (default 60s).
   * Not the complete movie duration and not the per-clip Grok limit.
   */
  episodeDurationSeconds: z.number().int().min(15).max(1800).optional(),
  /**
   * Complete story / movie duration in seconds (e.g. 300–1800).
   * When set, episode count is derived as ceil(story / episode).
   */
  storyDurationSeconds: z.number().int().min(15).max(3600).optional(),
  /** Max seconds per generated video clip (Grok Lite ≤15). */
  maxClipDurationSeconds: z.number().int().min(1).max(15).optional(),
  productionFormat: z.enum(['episodic', 'standalone']).optional(),
  episodesPerMovie: z.number().int().min(1).max(120).optional(),
  aspectRatio: z.preprocess((value) => {
    if (value === null || value === undefined) return '9:16';
    if (typeof value !== 'string') return '9:16';
    const trimmed = value.trim();
    // Series Studio is TikTok/YouTube Shorts vertical only.
    if (!trimmed || trimmed === '16:9' || trimmed === '1:1' || trimmed === '4:3') return '9:16';
    return trimmed;
  }, z.string().max(20).optional().default('9:16')),
  storyConcept: optionalText(8000),
  customCreativeInstructions: optionalText(8000),
  /**
   * Dialogue-driven cinematic production (Grok path).
   * Always treated as true for Series episode production (all lane types).
   * Persisted false is ignored by the orchestrator.
   */
  dialogueDrivenStorytelling: z.boolean().optional().default(true),
  narrationPreference: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(SERIES_NARRATION_PREFERENCE).optional().default('avoid'),
  ),
  dialogueDensity: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(SERIES_DIALOGUE_DENSITY).optional().default('high'),
  ),
  characterVoiceStyle: optionalText(500),
  accentPreference: optionalText(200),
  dialogueLanguage: optionalText(10, 2),
  lipSyncRequired: z.boolean().optional().default(true),
  subtitlePreference: z.boolean().optional().default(true),
  cinematicShotStyle: optionalText(1000),
  characterAnimationStyle: optionalText(1000),
  /** Cost / production efficiency controls for dialogue-driven episodes. */
  costMode: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(SERIES_COST_MODE_OPTIONS).optional().default('balanced'),
  ),
  reuseCharacterReferences: z.boolean().optional().default(true),
  preferFfmpegForReactions: z.boolean().optional().default(true),
  maxLipSyncSecondsPerEpisode: z.number().min(6).max(60).optional().default(24),
});

export type SeriesCreativeSettings = z.infer<typeof seriesCreativeSettingsSchema>;

export const EMPTY_SERIES_CREATIVE_SETTINGS: SeriesCreativeSettings =
  seriesCreativeSettingsSchema.parse({});

/**
 * Merge creative settings with precedence:
 * global < lane < movie override (partial objects).
 * System safety rules stay outside this merge (prompt builders).
 */
export function mergeSeriesCreativeSettings(
  ...layers: Array<
    | Partial<SeriesCreativeSettings>
    | typeof SERIES_DIALOGUE_CREATIVE_DEFAULTS
    | null
    | undefined
  >
): SeriesCreativeSettings {
  const merged: Record<string, unknown> = { ...EMPTY_SERIES_CREATIVE_SETTINGS };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      merged[key] = value;
    }
  }
  return seriesCreativeSettingsSchema.parse(merged);
}

export function parseSeriesCreativeSettings(raw: unknown): SeriesCreativeSettings {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SERIES_CREATIVE_SETTINGS };
  const parsed = seriesCreativeSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...EMPTY_SERIES_CREATIVE_SETTINGS };
}

/** Clip to Movie Architect Zod max lengths (multi-select themes often exceed theme max). */
function clipBriefField(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/** Build Movie Architect brief fields from merged creative settings. */
export function creativeSettingsToBriefFields(settings: SeriesCreativeSettings): {
  genre: string;
  subgenres: string[];
  theme?: string;
  targetAudience?: string;
  language?: string;
  tone?: string;
  visualDirection?: string;
  plannedEpisodeCount?: number;
  targetEpisodeDurationSeconds?: number;
  targetStoryDurationSeconds?: number;
  maxClipDurationSeconds?: number;
  productionFormat?: 'episodic' | 'standalone';
  additionalInstructions?: string;
} {
  const genres = settings.genres.length ? settings.genres : ['Cinematic drama'];
  const themeJoined = [...settings.themes].filter(Boolean).join('; ');
  const themeOverflow =
    themeJoined.length > 300 ? `Themes (full): ${themeJoined}` : null;
  // Soft seed only — must not lock every Plan Movie to the same plot.
  const conceptPart = settings.storyConcept?.trim()
    ? `Optional inspiration seed (do NOT copy this as the fixed plot; invent a fresh story that still fits the selected genres/themes): ${settings.storyConcept.trim()}`
    : null;

  // Language / dialogue rules are appended last so they win over long lane story concepts.
  const instructionParts = [
    'Story generation: invent an original, clear, emotionally engaging short movie from the selected genres/themes. Prefer 2–4 characters, plain spoken English, a misunderstanding/conflict that escalates, and an earned twist or satisfying ending. Do not concatenate labels. Do not force stock inheritance/bakery templates. Scale the same clarity from ~60s to ~10 minutes via connected episode parts.',
    themeOverflow,
    conceptPart,
    settings.narrativeTone ? `Narrative tone: ${settings.narrativeTone}` : null,
    settings.storytellingRules.length
      ? `Storytelling rules: ${settings.storytellingRules.join('; ')}`
      : null,
    settings.contentExclusions.length
      ? `Content exclusions (must respect): ${settings.contentExclusions.join('; ')}`
      : null,
    settings.excludedThemes.length
      ? `Excluded themes: ${settings.excludedThemes.join('; ')}`
      : null,
    settings.characterPreferences
      ? `Character preferences: ${settings.characterPreferences}`
      : null,
    settings.endingPreferences ? `Ending preferences: ${settings.endingPreferences}` : null,
    settings.cliffhangerIntensity
      ? `Cliffhanger intensity: ${settings.cliffhangerIntensity}`
      : null,
    settings.characterConsistencyRequired
      ? 'Character visual consistency is mandatory across all episodes.'
      : null,
    settings.aspectRatio ? `Aspect ratio: ${settings.aspectRatio}` : null,
    settings.customCreativeInstructions || null,
    settings.narrationPreferences
      ? `Narration preferences: ${settings.narrationPreferences}`
      : null,
    settings.dialogueDrivenStorytelling === true
      ? 'Dialogue-driven storytelling is required: characters speak to each other; avoid narrator-led format.'
      : null,
    settings.narrationPreference
      ? `Narration preference mode: ${settings.narrationPreference}`
      : null,
    settings.dialogueDensity ? `Dialogue density: ${settings.dialogueDensity}` : null,
    settings.dialogueStyle ? `Dialogue style: ${settings.dialogueStyle}` : null,
    settings.characterVoiceStyle
      ? `Character voice style: ${settings.characterVoiceStyle}`
      : null,
    settings.accentPreference ? `Accent preference: ${settings.accentPreference}` : null,
    settings.lipSyncRequired ? 'Lip-sync is mandatory for speaking shots.' : null,
    settings.costMode
      ? `Cost mode: ${settings.costMode}. Prefer Kling lip-sync only for speaking shots; use local FFmpeg camera moves for reaction/environment shots; do not use Hailuo for dialogue-driven episodes.`
      : null,
    settings.storyDurationSeconds
      ? `Complete story/movie duration: ${settings.storyDurationSeconds}s (independent from episode and clip durations).`
      : null,
    settings.productionFormat
      ? `Production format: ${settings.productionFormat}.`
      : null,
    settings.maxClipDurationSeconds
      ? `Individual video clip max duration: ${settings.maxClipDurationSeconds}s (Grok Lite cap 15s).`
      : null,
    settings.maxLipSyncSecondsPerEpisode
      ? `Keep total speaking/lip-sync duration near or under ${settings.maxLipSyncSecondsPerEpisode}s for a ~${settings.episodeDurationSeconds ?? 60}s episode (not the full movie duration).`
      : null,
    settings.preferFfmpegForReactions
      ? 'Reaction and environment coverage should be short still-based cinematic moves, not paid video generation.'
      : null,
    settings.cinematicShotStyle
      ? `Cinematic shot style: ${settings.cinematicShotStyle}`
      : null,
    settings.characterAnimationStyle
      ? `Character animation style: ${settings.characterAnimationStyle}`
      : null,
    settings.dialogueStyle || settings.customCreativeInstructions
      ? 'Language priority: keep dialogue and narration in clear everyday spoken English even when tone/concept is dramatic or cinematic.'
      : null,
  ].filter(Boolean) as string[];

  // Theme field = selected themes only (not a locked story concept).
  const themePrimary = settings.themes.slice(0, 4).join('; ');

  return {
    genre: clipBriefField(genres[0]!, 100) ?? 'Cinematic drama',
    subgenres: genres.slice(1).map((g) => clipBriefField(g, 80)!).filter(Boolean),
    theme: clipBriefField(themePrimary || themeJoined || undefined, 300),
    targetAudience: clipBriefField(settings.targetAudience, 200),
    language: clipBriefField(settings.language, 10),
    tone: clipBriefField(settings.tone ?? settings.narrativeTone, 100),
    visualDirection: clipBriefField(settings.visualStyle, 500),
    plannedEpisodeCount: settings.episodesPerMovie,
    targetEpisodeDurationSeconds: settings.episodeDurationSeconds,
    targetStoryDurationSeconds: settings.storyDurationSeconds,
    maxClipDurationSeconds: settings.maxClipDurationSeconds,
    productionFormat: settings.productionFormat,
    additionalInstructions: instructionParts.length
      ? clipBriefField(instructionParts.join('\n'), 8000)
      : undefined,
  };
}

/** Compact language/dialogue notes for episode script generation. */
export function buildCreativeLanguageStyleNotes(
  settings: SeriesCreativeSettings,
): string {
  return [
    settings.language ? `Language: ${settings.language}` : null,
    settings.dialogueLanguage ? `Dialogue language: ${settings.dialogueLanguage}` : null,
    settings.tone ? `Tone: ${settings.tone}` : null,
    settings.narrativeTone ? `Narrative tone: ${settings.narrativeTone}` : null,
    settings.dialogueStyle ? `Dialogue style: ${settings.dialogueStyle}` : null,
    settings.characterVoiceStyle
      ? `Character voice style: ${settings.characterVoiceStyle}`
      : null,
    settings.accentPreference ? `Accent preference: ${settings.accentPreference}` : null,
    settings.narrationPreference
      ? `Narration preference: ${settings.narrationPreference}`
      : null,
    settings.narrationPreferences
      ? `Narration preferences: ${settings.narrationPreferences}`
      : null,
    settings.customCreativeInstructions
      ? `Custom instructions: ${settings.customCreativeInstructions}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function isDialogueDrivenCreative(
  settings: SeriesCreativeSettings | null | undefined,
): boolean {
  // Parsed settings default dialogueDrivenStorytelling=true. Explicit false keeps narration/Hailuo.
  if (!settings) return false;
  return settings.dialogueDrivenStorytelling === true;
}
