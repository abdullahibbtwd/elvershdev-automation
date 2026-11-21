import { z } from 'zod';

/**
 * Persistent Series character identity profile.
 * Used for continuity digests and Grok Lite clip prompts.
 * Lite has no multi-reference face lock — textual canon + optional I2V still maximize consistency.
 */

export const seriesCharacterIdentityProfileSchema = z.object({
  name: z.string().min(1),
  ageDescription: z.string().min(1).optional().nullable(),
  ageRange: z.string().min(1).optional().nullable(),
  genderPresentation: z.string().optional().nullable(),
  skinTone: z.string().optional().nullable(),
  faceDescription: z.string().optional().nullable(),
  facialStructure: z.string().optional().nullable(),
  eyeColor: z.string().optional().nullable(),
  eyeShape: z.string().optional().nullable(),
  hairDescription: z.string().optional().nullable(),
  hairstyle: z.string().optional().nullable(),
  hairFurColor: z.string().optional().nullable(),
  facialHair: z.string().optional().nullable(),
  bodyDescription: z.string().optional().nullable(),
  bodyProportions: z.string().optional().nullable(),
  heightRelative: z.string().optional().nullable(),
  defaultClothing: z.string().optional().nullable(),
  clothing: z.string().optional().nullable(),
  accessories: z.string().optional().nullable(),
  markings: z.string().optional().nullable(),
  voiceDescription: z.string().optional().nullable(),
  voiceProfile: z.string().optional().nullable(),
  personality: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  species: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  physicalDescription: z.string().optional().nullable(),
  canonicalVisualDescription: z.string().optional().nullable(),
  visualConsistencyNotes: z.string().optional().nullable(),
  identityVersion: z.number().int().positive().optional(),
  approvedAt: z.union([z.string(), z.date()]).optional().nullable(),
});

export type SeriesCharacterIdentityProfile = z.infer<
  typeof seriesCharacterIdentityProfileSchema
>;

export const updateSeriesCharacterIdentitySchema = z
  .object({
    ageRange: z.string().max(80).optional(),
    ageDescription: z.string().max(120).optional(),
    genderPresentation: z.string().max(80).optional().nullable(),
    skinTone: z.string().max(120).optional().nullable(),
    facialStructure: z.string().max(2000).optional().nullable(),
    eyeColor: z.string().max(80).optional().nullable(),
    eyeShape: z.string().max(80).optional().nullable(),
    hairstyle: z.string().max(200).optional().nullable(),
    hairFurColor: z.string().max(120).optional().nullable(),
    facialHair: z.string().max(200).optional().nullable(),
    bodyProportions: z.string().max(2000).optional().nullable(),
    heightRelative: z.string().max(200).optional().nullable(),
    clothing: z.string().max(2000).optional().nullable(),
    accessories: z.string().max(2000).optional().nullable(),
    markings: z.string().max(2000).optional().nullable(),
    voiceProfile: z.string().max(2000).optional().nullable(),
    personality: z.string().max(4000).optional(),
    physicalDescription: z.string().max(8000).optional(),
    canonicalVisualDescription: z.string().max(8000).optional().nullable(),
    visualConsistencyNotes: z.string().max(4000).optional().nullable(),
    /** When true, rebuild canonicalVisualDescription from structured fields. */
    rebuildCanonicalDescription: z.boolean().optional(),
  })
  .strict();

export type UpdateSeriesCharacterIdentityInput = z.infer<
  typeof updateSeriesCharacterIdentitySchema
>;

function asText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value).trim();
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

export function composeHairDescription(profile: {
  hairstyle?: string | null;
  hairFurColor?: string | null;
  hairDescription?: string | null;
}): string {
  if (asText(profile.hairDescription)) return asText(profile.hairDescription);
  const color = asText(profile.hairFurColor);
  const style = asText(profile.hairstyle);
  if (style && color) return `${style}, ${color}`;
  return style || color;
}

export function composeFaceDescription(profile: {
  faceDescription?: string | null;
  facialStructure?: string | null;
  eyeColor?: string | null;
  eyeShape?: string | null;
  facialHair?: string | null;
}): string {
  if (asText(profile.faceDescription)) return asText(profile.faceDescription);
  return [
    asText(profile.facialStructure),
    asText(profile.eyeColor) || asText(profile.eyeShape)
      ? `eyes: ${[asText(profile.eyeColor), asText(profile.eyeShape)].filter(Boolean).join(' ')}`
      : '',
    asText(profile.facialHair) ? `facial hair: ${asText(profile.facialHair)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Build a stable canonical visual description from structured identity fields.
 * Prefer an already-approved stored canonical string unless rebuild is requested.
 */
export function buildSeriesCanonicalVisualDescription(
  profile: SeriesCharacterIdentityProfile | Record<string, unknown>,
): string {
  const p = profile as SeriesCharacterIdentityProfile;
  const name = asText(p.name) || 'Character';
  const age = firstNonEmpty(p.ageDescription, p.ageRange, 'adult');
  const parts = [
    name,
    asText(p.species) ? `${asText(p.species)}` : undefined,
    `age ${age}`,
    asText(p.genderPresentation) || undefined,
    asText(p.skinTone) || undefined,
    composeFaceDescription(p) || asText(p.physicalDescription) || undefined,
    (() => {
      const hair = composeHairDescription(p);
      return hair ? `hair: ${hair}` : undefined;
    })(),
    asText(p.facialHair) && !composeFaceDescription(p).includes('facial hair')
      ? `facial hair: ${asText(p.facialHair)}`
      : undefined,
    firstNonEmpty(p.bodyDescription, p.bodyProportions, p.heightRelative) || undefined,
    (() => {
      const clothing = firstNonEmpty(p.defaultClothing, p.clothing);
      return clothing ? `wearing ${clothing}` : undefined;
    })(),
    asText(p.accessories) && asText(p.accessories).toLowerCase() !== 'none'
      ? `accessories: ${asText(p.accessories)}`
      : undefined,
    asText(p.markings) && asText(p.markings).toLowerCase() !== 'none'
      ? `markings: ${asText(p.markings)}`
      : undefined,
    asText(p.visualConsistencyNotes) || undefined,
  ].filter(Boolean);

  return parts.join('; ');
}

/** Compact continuity digest line reused across episode scripting. */
export function buildCharacterIdentityDigestLine(
  profile: SeriesCharacterIdentityProfile & {
    lifecycleStatus?: string | null;
    secrets?: unknown;
  },
): string {
  const canonical =
    asText(profile.canonicalVisualDescription) ||
    buildSeriesCanonicalVisualDescription(profile);
  const clothing = firstNonEmpty(profile.defaultClothing, profile.clothing);
  const voice = firstNonEmpty(profile.voiceDescription, profile.voiceProfile);
  return [
    `- ${asText(profile.name)} (${asText(profile.role) || 'SUPPORTING'}, ${asText(profile.species) || 'human'})`,
    `identity v${profile.identityVersion ?? 1}${profile.approvedAt ? ' approved' : ' draft'}`,
    canonical,
    clothing ? `default clothing: ${clothing}` : null,
    voice ? `voice: ${voice}` : null,
    profile.lifecycleStatus ? `status=${profile.lifecycleStatus}` : null,
    profile.secrets != null ? `secrets=${JSON.stringify(profile.secrets)}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Prompt block for Grok Lite clip generation.
 * Reuses the same canonical text every time — do not invent a new face description.
 */
export function formatCharacterIdentityForClipPrompt(
  profile: SeriesCharacterIdentityProfile,
  options?: {
    clothingOverride?: string | null;
    appearanceChangeNotes?: string | null;
  },
): string {
  const canonical =
    asText(profile.canonicalVisualDescription) ||
    buildSeriesCanonicalVisualDescription(profile);
  const clothing =
    asText(options?.clothingOverride) ||
    firstNonEmpty(profile.defaultClothing, profile.clothing) ||
    'consistent series wardrobe';
  const voice = firstNonEmpty(profile.voiceDescription, profile.voiceProfile);
  const personality = asText(profile.personality);

  return [
    `CHARACTER: ${asText(profile.name)}`,
    `CANONICAL IDENTITY (do not redesign): ${canonical}`,
    `CLOTHING THIS CLIP: ${clothing}`,
    voice ? `VOICE: ${voice}` : null,
    personality ? `PERSONALITY: ${personality}` : null,
    asText(options?.appearanceChangeNotes)
      ? `APPROVED APPEARANCE CHANGE: ${asText(options?.appearanceChangeNotes)}`
      : 'RESTRICTION: No unexpected costume or identity changes.',
    asText(profile.visualConsistencyNotes)
      ? `CONSISTENCY NOTES: ${asText(profile.visualConsistencyNotes)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export type CharacterClipValidationIssue = {
  code:
    | 'missing_character'
    | 'missing_canonical_description'
    | 'unapproved_identity'
    | 'clothing_conflict'
    | 'appearance_conflict';
  severity: 'error' | 'warning';
  characterName: string;
  message: string;
  suggestedFix?: string;
};

export function validateCharactersForClipProduction(input: {
  appearingCharacterNames: string[];
  profilesByName: Record<string, SeriesCharacterIdentityProfile | undefined>;
  requireApproved?: boolean;
  screenplayClothingByCharacter?: Record<string, string | undefined>;
  screenplayAppearanceNotesByCharacter?: Record<string, string | undefined>;
}): { ok: boolean; issues: CharacterClipValidationIssue[] } {
  const issues: CharacterClipValidationIssue[] = [];
  const requireApproved = input.requireApproved !== false;

  for (const name of input.appearingCharacterNames) {
    const profile = input.profilesByName[name] ?? input.profilesByName[name.toLowerCase()];
    if (!profile) {
      issues.push({
        code: 'missing_character',
        severity: 'error',
        characterName: name,
        message: `Clip references unknown character "${name}".`,
        suggestedFix: 'Use only approved series roster names.',
      });
      continue;
    }

    const canonical = asText(profile.canonicalVisualDescription);
    if (!canonical) {
      issues.push({
        code: 'missing_canonical_description',
        severity: 'error',
        characterName: name,
        message: `${name} is missing a locked canonical visual description.`,
        suggestedFix: 'Generate or rebuild and approve the character identity profile.',
      });
    }

    if (requireApproved && !profile.approvedAt) {
      issues.push({
        code: 'unapproved_identity',
        severity: 'warning',
        characterName: name,
        message: `${name} identity is not approved yet.`,
        suggestedFix: 'Review and approve the character identity before production.',
      });
    }

    const clothingOverride = input.screenplayClothingByCharacter?.[name];
    const defaultClothing = firstNonEmpty(profile.defaultClothing, profile.clothing);
    if (
      clothingOverride &&
      defaultClothing &&
      !clothingOverride.toLowerCase().includes(defaultClothing.slice(0, 24).toLowerCase()) &&
      !asText(input.screenplayAppearanceNotesByCharacter?.[name])
    ) {
      issues.push({
        code: 'clothing_conflict',
        severity: 'warning',
        characterName: name,
        message: `${name} screenplay clothing differs from default wardrobe without documented change.`,
        suggestedFix: 'Document the intentional wardrobe change in appearance notes.',
      });
    }

    const appearanceNote = input.screenplayAppearanceNotesByCharacter?.[name];
    if (
      appearanceNote &&
      /redesign|new face|different person|completely different/i.test(appearanceNote)
    ) {
      issues.push({
        code: 'appearance_conflict',
        severity: 'error',
        characterName: name,
        message: `${name} appearance notes request an identity redesign.`,
        suggestedFix: 'Keep the approved face/identity; only document temporary wardrobe or injury changes.',
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

export function seriesCharacterToIdentityProfile(character: {
  name: string;
  role?: string | null;
  species?: string | null;
  ageRange?: string | null;
  genderPresentation?: string | null;
  skinTone?: string | null;
  facialStructure?: string | null;
  eyeColor?: string | null;
  eyeShape?: string | null;
  hairstyle?: string | null;
  hairFurColor?: string | null;
  facialHair?: string | null;
  bodyProportions?: string | null;
  heightRelative?: string | null;
  clothing?: string | null;
  accessories?: string | null;
  markings?: string | null;
  voiceProfile?: string | null;
  personality?: string | null;
  physicalDescription?: string | null;
  canonicalVisualDescription?: string | null;
  visualConsistencyNotes?: string | null;
  identityVersion?: number | null;
  approvedAt?: Date | string | null;
  lifecycleStatus?: string | null;
  secrets?: unknown;
}): SeriesCharacterIdentityProfile & {
  lifecycleStatus?: string | null;
  secrets?: unknown;
} {
  return {
    name: character.name,
    role: character.role ?? undefined,
    species: character.species ?? undefined,
    ageRange: character.ageRange ?? undefined,
    ageDescription: character.ageRange ?? undefined,
    genderPresentation: character.genderPresentation ?? undefined,
    skinTone: character.skinTone ?? undefined,
    facialStructure: character.facialStructure ?? undefined,
    eyeColor: character.eyeColor ?? undefined,
    eyeShape: character.eyeShape ?? undefined,
    hairstyle: character.hairstyle ?? undefined,
    hairFurColor: character.hairFurColor ?? undefined,
    facialHair: character.facialHair ?? undefined,
    bodyProportions: character.bodyProportions ?? undefined,
    heightRelative: character.heightRelative ?? undefined,
    clothing: character.clothing ?? undefined,
    defaultClothing: character.clothing ?? undefined,
    accessories: character.accessories ?? undefined,
    markings: character.markings ?? undefined,
    voiceProfile: character.voiceProfile ?? undefined,
    voiceDescription: character.voiceProfile ?? undefined,
    personality: character.personality ?? undefined,
    physicalDescription: character.physicalDescription ?? undefined,
    faceDescription: composeFaceDescription(character),
    hairDescription: composeHairDescription(character),
    bodyDescription: firstNonEmpty(character.bodyProportions, character.heightRelative) || undefined,
    canonicalVisualDescription: character.canonicalVisualDescription ?? undefined,
    visualConsistencyNotes: character.visualConsistencyNotes ?? undefined,
    identityVersion: character.identityVersion ?? 1,
    approvedAt: character.approvedAt ?? undefined,
    lifecycleStatus: character.lifecycleStatus ?? undefined,
    secrets: character.secrets,
  };
}
