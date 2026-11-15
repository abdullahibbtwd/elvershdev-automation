import { z } from 'zod';

export const emailSchema = z.string().email();

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Password must contain at least one letter and one number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createStorySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
  status: z.enum(['DRAFT', 'GENERATING', 'READY', 'FAILED', 'ARCHIVED']).optional(),
});

export const updateStorySchema = createStorySchema.partial();

export const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  storyId: z.string().uuid().optional(),
  duration: z.number().int().min(1).max(3600).optional(),
  aspectRatio: z.string().max(20).optional(),
  targetPlatforms: z
    .array(z.enum(['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE']))
    .optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  storyId: z.string().uuid().nullable().optional(),
  status: z
    .enum(['DRAFT', 'PROCESSING', 'RENDERING', 'READY', 'FAILED', 'PUBLISHED'])
    .optional(),
});

export const mediaUploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive().optional(),
});

export const createJobSchema = z.object({
  jobType: z.enum([
    'STORY',
    'IMAGE',
    'VIDEO',
    'NARRATION_PLANNING',
    'VOICE',
    'RENDER',
    'PUBLISH',
    'ANALYTICS',
  ]),
  videoProjectId: z.string().uuid().optional(),
  provider: z.string().optional(),
  estimatedCost: z.number().min(0).optional(),
  payload: z.record(z.unknown()).optional(),
});

export const publishJobSchema = z.object({
  mediaId: z.string().uuid(),
  channelIds: z.array(z.string().uuid()).min(1),
  scheduledAt: z.string().datetime().optional(),
  caption: z.string().max(2200).optional(),
});

export const socialPlatformSchema = z.enum(['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE']);

export const platformPublishSettingsSchema = z
  .object({
    privacyStatus: z
      .enum([
        'public',
        'unlisted',
        'private',
        'PUBLIC_TO_EVERYONE',
        'MUTUAL_FOLLOW_FRIENDS',
        'FOLLOWER_OF_CREATOR',
        'SELF_ONLY',
      ])
      .optional(),
    disableComment: z.boolean().optional(),
    disableDuet: z.boolean().optional(),
    disableStitch: z.boolean().optional(),
    brandContentToggle: z.boolean().optional(),
    brandOrganicToggle: z.boolean().optional(),
    isAigc: z.boolean().optional(),
    isAiGenerated: z.boolean().optional(),
    madeForKids: z.boolean().optional(),
    notifySubscribers: z.boolean().optional(),
    categoryId: z.string().optional(),
    tags: z.array(z.string().max(100)).max(30).optional(),
    thumbOffsetMs: z.number().int().min(0).optional(),
    coverUrl: z.string().url().optional(),
    shareToFeed: z.boolean().optional(),
  })
  .passthrough();

export const channelPublishTargetSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().max(100).optional(),
  caption: z.string().max(2200).optional(),
  description: z.string().max(5000).optional(),
  hashtags: z.array(z.string().max(100)).max(30).optional(),
  platformSettings: platformPublishSettingsSchema.optional(),
});

export const publishRenderSchema = z.object({
  targets: z.array(channelPublishTargetSchema).min(1).max(20),
  /** Optional shared defaults applied when a target omits a field */
  defaults: z
    .object({
      title: z.string().max(100).optional(),
      caption: z.string().max(2200).optional(),
      description: z.string().max(5000).optional(),
      hashtags: z.array(z.string().max(100)).max(30).optional(),
    })
    .optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const updatePublicationSchema = z.object({
  title: z.string().max(100).optional(),
  caption: z.string().max(2200).optional(),
  description: z.string().max(5000).optional(),
  hashtags: z.array(z.string().max(100)).max(30).optional(),
  platformSettings: platformPublishSettingsSchema.optional(),
});

export const captionSuggestionSchema = z.object({
  platform: socialPlatformSchema,
  storyTitle: z.string().max(200).optional(),
  storyDescription: z.string().max(2000).optional(),
  existingCaption: z.string().max(2200).optional(),
  tone: z.string().max(80).optional(),
  maxHashtags: z.number().int().min(0).max(30).default(8),
});

export const captionSuggestionResultSchema = z.object({
  title: z.string().max(100).optional(),
  caption: z.string().max(2200),
  description: z.string().max(5000).optional(),
  hashtags: z.array(z.string().max(100)).max(30),
});

export type PublishRenderInput = z.infer<typeof publishRenderSchema>;
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;
export type CaptionSuggestionInput = z.infer<typeof captionSuggestionSchema>;
export type CaptionSuggestionResult = z.infer<typeof captionSuggestionResultSchema>;
export type ChannelPublishTarget = z.infer<typeof channelPublishTargetSchema>;

export const scheduleJobSchema = z.object({
  title: z.string().min(1).max(200),
  cronExpression: z.string().min(1).optional(),
  runAt: z.string().datetime().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateStoryInput = z.infer<typeof createStorySchema>;
export type UpdateStoryInput = z.infer<typeof updateStorySchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type PublishJobInput = z.infer<typeof publishJobSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
