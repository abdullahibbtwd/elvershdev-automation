import { z } from 'zod';
import { GEMINI_PREBUILT_VOICE_IDS, DEFAULT_GEMINI_TTS_VOICE } from '../voice-ai/voices';

export const CHARACTER_VOICE_EMOTIONS = [
  'angry',
  'sad',
  'happy',
  'frightened',
  'suspicious',
  'calm',
  'excited',
  'whispering',
  'neutral',
] as const;

export const seriesCharacterVoiceAssignmentSchema = z.object({
  seriesCharacterId: z.string().uuid().optional(),
  characterName: z.string().min(1).max(100),
  voiceProfileId: z.string().uuid().optional(),
  provider: z.string().default('gemini'),
  providerVoiceId: z
    .string()
    .min(1)
    .refine((id) => GEMINI_PREBUILT_VOICE_IDS.includes(id), {
      message: 'providerVoiceId must be a known Gemini prebuilt voice',
    }),
  voiceDescription: z.string().max(500).optional().default(''),
  genderPresentation: z.string().max(80).optional().default(''),
  approximateVocalAge: z.string().max(80).optional().default(''),
  accent: z.string().max(120).optional().default(''),
  pitch: z.string().max(80).optional().default('medium'),
  speakingStyle: z.string().max(300).optional().default('natural conversational'),
  emotionalRange: z.array(z.string().min(1).max(40)).max(12).default([]),
  speechSpeed: z.enum(['slow', 'normal', 'fast']).default('normal'),
  consistencyLocked: z.boolean().default(true),
});

export type SeriesCharacterVoiceAssignment = z.infer<
  typeof seriesCharacterVoiceAssignmentSchema
>;

/** Deterministic voice picker from Gemini prebuilt list — sticky by character name. */
const VOICE_POOL = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Algenib',
  'Gacrux',
  'Sulafat',
  'Achird',
  'Enceladus',
  'Iapetus',
  'Despina',
] as const;

export function hashStringToIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return modulo <= 0 ? 0 : hash % modulo;
}

export function pickStableGeminiVoiceForCharacter(
  characterName: string,
  usedVoiceIds: Iterable<string> = [],
): string {
  const used = new Set([...usedVoiceIds].map((v) => v.trim()));
  const preferredIndex = hashStringToIndex(characterName.trim().toLowerCase(), VOICE_POOL.length);
  for (let offset = 0; offset < VOICE_POOL.length; offset += 1) {
    const candidate = VOICE_POOL[(preferredIndex + offset) % VOICE_POOL.length]!;
    if (!used.has(candidate)) return candidate;
  }
  return VOICE_POOL[preferredIndex] ?? DEFAULT_GEMINI_TTS_VOICE;
}

export function buildSpeakingStyleForEmotion(
  baseStyle: string,
  emotion: string,
): string {
  const e = emotion.trim().toLowerCase();
  const emotionHint = e ? ` Deliver with a ${e} emotional tone.` : '';
  return `${baseStyle.trim() || 'natural conversational'}.${emotionHint}`.trim();
}
