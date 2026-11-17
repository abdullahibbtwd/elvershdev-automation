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

export const seriesCreativeSettingsSchema = z.object({
  genres: z.array(z.string().min(1).max(80)).max(12).default([]),
  themes: z.array(z.string().min(1).max(120)).max(20).default([]),
  excludedThemes: z.array(z.string().min(1).max(120)).max(20).default([]),
  targetAudience: z.string().max(200).optional(),
  language: z.string().min(2).max(10).optional(),
  tone: z.string().max(100).optional(),
  dialogueStyle: z.string().max(300).optional(),
  narrativeTone: z.string().max(300).optional(),
  storytellingRules: z.array(z.string().min(1).max(400)).max(20).default([]),
  contentExclusions: z.array(z.string().min(1).max(400)).max(20).default([]),
  characterPreferences: z.string().max(2000).optional(),
  endingPreferences: z.string().max(2000).optional(),
  cliffhangerIntensity: z.enum(SERIES_CLIFFHANGER_INTENSITY).optional(),
  visualStyle: z.string().max(2000).optional(),
  characterConsistencyRequired: z.boolean().optional(),
  narrationPreferences: z.string().max(2000).optional(),
  episodeDurationSeconds: z.number().int().min(15).max(600).optional(),
  episodesPerMovie: z.number().int().min(2).max(120).optional(),
  aspectRatio: z.string().max(20).optional(),
  storyConcept: z.string().max(8000).optional(),
  customCreativeInstructions: z.string().max(8000).optional(),
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
  ...layers: Array<Partial<SeriesCreativeSettings> | null | undefined>
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
  additionalInstructions?: string;
} {
  const genres = settings.genres.length ? settings.genres : ['Cinematic drama'];
  const themeJoined = [...settings.themes].filter(Boolean).join('; ');
  const themeOverflow =
    themeJoined.length > 300 ? `Themes (full): ${themeJoined}` : null;
  const conceptPart = settings.storyConcept
    ? `Concept: ${settings.storyConcept}`
    : null;

  const instructionParts = [
    themeOverflow,
    conceptPart && themeJoined.length > 200 ? conceptPart : null,
    settings.dialogueStyle ? `Dialogue style: ${settings.dialogueStyle}` : null,
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
    settings.narrationPreferences
      ? `Narration preferences: ${settings.narrationPreferences}`
      : null,
    settings.aspectRatio ? `Aspect ratio: ${settings.aspectRatio}` : null,
    settings.customCreativeInstructions || null,
  ].filter(Boolean) as string[];

  const themePrimary = [
    ...settings.themes.slice(0, 4),
    themeJoined.length <= 200 && settings.storyConcept
      ? `Concept: ${settings.storyConcept}`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

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
    settings.tone ? `Tone: ${settings.tone}` : null,
    settings.narrativeTone ? `Narrative tone: ${settings.narrativeTone}` : null,
    settings.dialogueStyle ? `Dialogue style: ${settings.dialogueStyle}` : null,
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
