/**
 * Gemini 3.8 TTS prebuilt studio voices.
 * Source: https://aistudio.google.com/docs/speech-generation (Voice options)
 * Do not invent additional voice IDs beyond this curated list unless loaded from the Voices API.
 */

export interface GeminiPrebuiltVoice {
  id: string;
  name: string;
  description: string;
}

/** 30 curated prebuilt studio voices from official Gemini TTS docs. */
export const GEMINI_PREBUILT_VOICES: readonly GeminiPrebuiltVoice[] = [
  { id: 'Zephyr', name: 'Zephyr', description: 'Bright' },
  { id: 'Puck', name: 'Puck', description: 'Upbeat' },
  { id: 'Charon', name: 'Charon', description: 'Informative' },
  { id: 'Kore', name: 'Kore', description: 'Firm' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Excitable' },
  { id: 'Leda', name: 'Leda', description: 'Youthful' },
  { id: 'Orus', name: 'Orus', description: 'Firm' },
  { id: 'Aoede', name: 'Aoede', description: 'Breezy' },
  { id: 'Callirrhoe', name: 'Callirrhoe', description: 'Easy-going' },
  { id: 'Autonoe', name: 'Autonoe', description: 'Bright' },
  { id: 'Enceladus', name: 'Enceladus', description: 'Breathy' },
  { id: 'Iapetus', name: 'Iapetus', description: 'Clear' },
  { id: 'Umbriel', name: 'Umbriel', description: 'Easy-going' },
  { id: 'Algieba', name: 'Algieba', description: 'Smooth' },
  { id: 'Despina', name: 'Despina', description: 'Smooth' },
  { id: 'Erinome', name: 'Erinome', description: 'Clear' },
  { id: 'Algenib', name: 'Algenib', description: 'Gravelly' },
  { id: 'Rasalgethi', name: 'Rasalgethi', description: 'Informative' },
  { id: 'Laomedeia', name: 'Laomedeia', description: 'Upbeat' },
  { id: 'Achernar', name: 'Achernar', description: 'Soft' },
  { id: 'Alnilam', name: 'Alnilam', description: 'Firm' },
  { id: 'Schedar', name: 'Schedar', description: 'Even' },
  { id: 'Gacrux', name: 'Gacrux', description: 'Mature' },
  { id: 'Pulcherrima', name: 'Pulcherrima', description: 'Forward' },
  { id: 'Achird', name: 'Achird', description: 'Friendly' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', description: 'Casual' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', description: 'Gentle' },
  { id: 'Sadachbia', name: 'Sadachbia', description: 'Lively' },
  { id: 'Sadaltager', name: 'Sadaltager', description: 'Knowledgeable' },
  { id: 'Sulafat', name: 'Sulafat', description: 'Warm' },
] as const;

export const GEMINI_PREBUILT_VOICE_IDS = GEMINI_PREBUILT_VOICES.map((v) => v.id);

export const DEFAULT_GEMINI_TTS_VOICE = 'Kore';

export function isGeminiPrebuiltVoice(voiceId: string): boolean {
  return GEMINI_PREBUILT_VOICE_IDS.includes(voiceId);
}
