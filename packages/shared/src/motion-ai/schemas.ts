import { z } from 'zod';

export const motionBriefSchema = z.object({
  mainSubject: z.string().min(1),
  characterMovement: z.string().min(1),
  facialExpressions: z.string().min(1),
  bodyMovement: z.string().min(1),
  environmentalMovement: z.string().min(1),
  cameraMovement: z.string().min(1),
  cameraAngle: z.string().min(1),
  cameraDistance: z.string().min(1),
  sceneAtmosphere: z.string().min(1),
  lightingContinuity: z.string().min(1),
  movementSpeed: z.string().min(1),
  emotionalIntention: z.string().min(1),
  startFrameConsistency: z.string().min(1),
  endFrameComposition: z.string().min(1),
  motionPrompt: z.string().min(1).max(2500),
  negativePrompt: z.string().min(1).max(1000),
});

export const motionAnalysisBatchSchema = z.object({
  scenes: z
    .array(
      motionBriefSchema.extend({
        sceneNumber: z.number().int().min(1),
      }),
    )
    .min(1),
});

export const klingResolutionSchema = z.enum(['720p', '1080p']);
export const klingDurationSchema = z.union([z.literal(5), z.literal(10)]);

export const generateStoryMotionSchema = z.object({
  sceneIds: z.array(z.string().uuid()).optional(),
  durationSeconds: klingDurationSchema.optional(),
  resolution: klingResolutionSchema.optional(),
  motionPrompt: z.string().min(1).max(2500).optional(),
  negativePrompt: z.string().max(1000).optional(),
  skipAnalysis: z.boolean().optional(),
  simulateFailure: z.boolean().optional(),
});

export const generateSceneMotionSchema = z.object({
  durationSeconds: klingDurationSchema.optional(),
  resolution: klingResolutionSchema.optional(),
  motionPrompt: z.string().min(1).max(2500).optional(),
  negativePrompt: z.string().max(1000).optional(),
  sourceVisualId: z.string().uuid().optional(),
  skipAnalysis: z.boolean().optional(),
  simulateFailure: z.boolean().optional(),
});

export const updateMotionGenerationSchema = z.object({
  motionPrompt: z.string().min(1).max(2500).optional(),
  negativePrompt: z.string().max(1000).optional(),
  isSelected: z.boolean().optional(),
});

export type MotionBrief = z.infer<typeof motionBriefSchema>;
export type MotionAnalysisBatch = z.infer<typeof motionAnalysisBatchSchema>;
export type GenerateStoryMotionInput = z.infer<typeof generateStoryMotionSchema>;
export type GenerateSceneMotionInput = z.infer<typeof generateSceneMotionSchema>;
export type UpdateMotionGenerationInput = z.infer<typeof updateMotionGenerationSchema>;
export type KlingResolution = z.infer<typeof klingResolutionSchema>;
export type KlingDuration = z.infer<typeof klingDurationSchema>;

export type MotionJobAction =
  | 'analyze_story_motion'
  | 'analyze_scene_motion'
  | 'submit_image_to_video'
  | 'poll_video_status'
  | 'download_video'
  | 'regenerate_scene_motion';

export const MOTION_ACTIVE_STATUSES = [
  'PENDING',
  'ANALYZING',
  'SUBMITTING',
  'PROCESSING',
  'DOWNLOADING',
  'VALIDATING',
] as const;

export type MotionActiveStatus = (typeof MOTION_ACTIVE_STATUSES)[number];
