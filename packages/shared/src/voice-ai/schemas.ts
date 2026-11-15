import { z } from 'zod';
import { GEMINI_PREBUILT_VOICE_IDS, DEFAULT_GEMINI_TTS_VOICE } from './voices';

export const narrationEmotionalToneSchema = z
  .string()
  .min(1)
  .max(100)
  .describe('Emotional tone for delivery, e.g. warm, urgent, reflective');

export const narrationSpeakingStyleSchema = z
  .string()
  .min(1)
  .max(200)
  .describe('Speaking style for speech_metadata.style, e.g. calm and measured');

export const plannedSceneNarrationSchema = z.object({
  sceneId: z.string().uuid().optional(),
  sceneNumber: z.number().int().min(1),
  text: z.string().min(1).max(4000),
  emotionalTone: narrationEmotionalToneSchema,
  speakingStyle: narrationSpeakingStyleSchema,
  deliveryInstructions: z.string().max(500).optional().default(''),
  pronunciationGuidance: z.string().max(500).optional().default(''),
  estimatedDurationSeconds: z.number().positive().max(600),
  sequence: z.number().int().min(1),
});

export const plannedNarrationScriptSchema = z.object({
  fullText: z.string().min(1).max(50000),
  scenes: z.array(plannedSceneNarrationSchema).min(1),
  notes: z.string().max(2000).optional().default(''),
});

export const voiceProfileConfigurationSchema = z
  .object({
    /** Maps to speech_metadata.style when generating (supported by Gemini 3.8 TTS). */
    speakingStyle: z.string().max(200).optional(),
    language: z.string().min(2).max(16).optional(),
  })
  .strict();

export const createVoiceProfileSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.literal('gemini').default('gemini'),
  providerVoiceId: z
    .string()
    .min(1)
    .max(100)
    .refine((id) => GEMINI_PREBUILT_VOICE_IDS.includes(id), {
      message: 'Unsupported Gemini prebuilt voice id',
    }),
  language: z.string().min(2).max(16).default('en'),
  configuration: voiceProfileConfigurationSchema.optional().default({}),
  isDefault: z.boolean().optional().default(false),
});

export const updateVoiceProfileSchema = createVoiceProfileSchema.partial().omit({ provider: true });

export const updateNarrationScriptSchema = z.object({
  scenes: z
    .array(
      z.object({
        id: z.string().uuid(),
        text: z.string().min(1).max(4000).optional(),
        emotionalTone: narrationEmotionalToneSchema.optional(),
        speakingStyle: narrationSpeakingStyleSchema.optional(),
        deliveryInstructions: z.string().max(500).optional(),
        pronunciationGuidance: z.string().max(500).optional(),
        estimatedDurationSeconds: z.number().positive().max(600).optional(),
      }),
    )
    .min(1)
    .optional(),
  fullText: z.string().min(1).max(50000).optional(),
});

export const planNarrationSchema = z.object({
  regenerate: z.boolean().optional().default(false),
  simulateFailure: z.boolean().optional().default(false),
  useMockAi: z.boolean().optional(),
});

export const generateStoryAudioSchema = z.object({
  voiceProfileId: z.string().uuid().optional(),
  providerVoiceId: z
    .string()
    .min(1)
    .max(100)
    .refine((id) => GEMINI_PREBUILT_VOICE_IDS.includes(id), {
      message: 'Unsupported Gemini prebuilt voice id',
    })
    .optional(),
  speakingStyle: z.string().max(200).optional(),
  sceneIds: z.array(z.string().uuid()).min(1).optional(),
  forceRegenerate: z.boolean().optional().default(false),
  simulateFailure: z.boolean().optional().default(false),
  useMockAi: z.boolean().optional(),
});

export const generateSceneAudioSchema = generateStoryAudioSchema.omit({ sceneIds: true });

export const speechGenerationRequestSchema = z.object({
  text: z.string().min(1).max(8000),
  voiceId: z.string().min(1).max(100).default(DEFAULT_GEMINI_TTS_VOICE),
  speakingStyle: z.string().max(200).optional(),
  language: z.string().min(2).max(16).optional(),
  mimeType: z.enum(['audio/wav', 'audio/l16']).optional().default('audio/wav'),
});

export type PlannedSceneNarration = z.infer<typeof plannedSceneNarrationSchema>;
export type PlannedNarrationScript = z.infer<typeof plannedNarrationScriptSchema>;
export type VoiceProfileConfiguration = z.infer<typeof voiceProfileConfigurationSchema>;
export type CreateVoiceProfileInput = z.infer<typeof createVoiceProfileSchema>;
export type UpdateVoiceProfileInput = z.infer<typeof updateVoiceProfileSchema>;
export type UpdateNarrationScriptInput = z.infer<typeof updateNarrationScriptSchema>;
export type PlanNarrationInput = z.infer<typeof planNarrationSchema>;
export type GenerateStoryAudioInput = z.infer<typeof generateStoryAudioSchema>;
export type GenerateSceneAudioInput = z.infer<typeof generateSceneAudioSchema>;
export type SpeechGenerationRequest = z.infer<typeof speechGenerationRequestSchema>;
