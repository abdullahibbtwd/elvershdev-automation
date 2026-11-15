import { z } from 'zod';
import { DEFAULT_VIDEO_OUTPUT_PROFILE_ID, VIDEO_OUTPUT_PROFILES } from './profiles';

export const subtitleStyleSchema = z.object({
  font: z.string().min(1).max(100).default('Arial'),
  fontSize: z.number().int().min(12).max(96).default(48),
  primaryColor: z.string().min(3).max(20).default('#FFFFFF'),
  outlineColor: z.string().min(3).max(20).default('#000000'),
  outlineWidth: z.number().min(0).max(8).default(2.5),
  shadow: z.number().min(0).max(8).default(1),
  // `lower` ≈ 3/4 down the frame (below center, above classic bottom).
  alignment: z.enum(['bottom', 'center', 'top', 'lower']).default('lower'),
  marginV: z.number().int().min(0).max(800).default(160),
  maxLines: z.number().int().min(1).max(4).default(2),
  maxCharsPerLine: z.number().int().min(12).max(80).default(36),
  backgroundBox: z.boolean().default(false),
  backgroundOpacity: z.number().min(0).max(1).default(0.45),
});

export const audioMixSettingsSchema = z.object({
  narrationVolume: z.number().min(0).max(2).default(1),
  musicVolume: z.number().min(0).max(1).default(0.22),
  sfxVolume: z.number().min(0).max(1).default(0.35),
  duckingEnabled: z.boolean().default(true),
  duckingThresholdDb: z.number().min(-60).max(0).default(-18),
  duckingRatio: z.number().min(1).max(20).default(8),
  duckingAttackMs: z.number().min(1).max(2000).default(80),
  duckingReleaseMs: z.number().min(1).max(5000).default(400),
  fadeInSeconds: z.number().min(0).max(5).default(0.4),
  fadeOutSeconds: z.number().min(0).max(5).default(0.6),
  sceneGapSeconds: z.number().min(0).max(2).default(0.15),
});

export const renderSettingsSchema = z.object({
  profileId: z
    .string()
    .default(DEFAULT_VIDEO_OUTPUT_PROFILE_ID)
    .refine((id) => Boolean(VIDEO_OUTPUT_PROFILES[id]), {
      message: 'Unsupported video output profile',
    }),
  subtitleEnabled: z.boolean().default(true),
  subtitleBurnedIn: z.boolean().default(true),
  transitionDurationSeconds: z.number().min(0).max(1.5).default(0.35),
  scenePaddingSeconds: z.number().min(0).max(2).default(0.2),
  kenBurnsEnabled: z.boolean().default(true),
  kenBurnsZoom: z.number().min(1).max(1.2).default(1.08),
  fitMode: z.enum(['crop', 'blur_pad']).default('crop'),
  qualityPreset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']).default('medium'),
  subtitleStyle: subtitleStyleSchema.default({}),
  audioMix: audioMixSettingsSchema.default({}),
});

export const createVideoRenderSchema = renderSettingsSchema.extend({
  backgroundMusicAssetId: z.string().uuid().nullable().optional(),
  simulateFailure: z.boolean().optional(),
});

export const updateVideoRenderSettingsSchema = renderSettingsSchema.partial().extend({
  backgroundMusicAssetId: z.string().uuid().nullable().optional(),
});

/** Parsed/output shapes (defaults applied). */
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type AudioMixSettings = z.infer<typeof audioMixSettingsSchema>;
export type RenderSettings = z.infer<typeof renderSettingsSchema>;
export type CreateVideoRenderInput = z.infer<typeof createVideoRenderSchema>;
export type UpdateVideoRenderSettingsInput = z.infer<typeof updateVideoRenderSettingsSchema>;

/**
 * Pre-parse input shapes. Fields with Zod defaults are optional, including nested
 * `audioMix` / `subtitleStyle` — safe for Partial-like callers and `schema.parse()`.
 */
export type SubtitleStyleInput = z.input<typeof subtitleStyleSchema>;
export type AudioMixSettingsInput = z.input<typeof audioMixSettingsSchema>;
export type RenderSettingsInput = z.input<typeof renderSettingsSchema>;
