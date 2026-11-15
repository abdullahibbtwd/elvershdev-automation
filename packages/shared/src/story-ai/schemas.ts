import { z } from 'zod';

export const storyBriefSchema = z.object({
  topic: z.string().min(3).max(500),
  niche: z.string().min(2).max(100),
  targetAudience: z.string().min(2).max(200),
  language: z.string().min(2).max(10).default('en'),
  tone: z.string().min(2).max(100),
  desiredDurationSeconds: z.number().int().min(15).max(600),
  category: z.string().min(2).max(100),
  additionalInstructions: z.string().max(8000).optional(),
});

export const generatedStorySchema = z.object({
  title: z.string().min(1).max(200),
  story: z.string().min(1),
  openingHook: z.string().min(1),
  narrationScript: z.string().min(1),
  closingMessage: z.string().min(1),
  description: z.string().min(1),
  hashtags: z.array(z.string().min(1).max(50)).min(1).max(30),
  characters: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        appearance: z.string().min(1),
        clothing: z.string().min(1),
        ageRange: z.string().min(1).max(50),
        hair: z.string().min(1),
        distinctiveFeatures: z.string().min(1),
        consistencyNotes: z.string().min(1),
      }),
    )
    .default([]),
});

export const generatedSceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().positive(),
  narration: z.string().min(1),
  visualDescription: z.string().min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  cameraMovement: z.string().min(1),
  lighting: z.string().min(1),
  environment: z.string().min(1),
  characterConsistencyInstructions: z.string().min(1),
});

export const generatedScenePlanSchema = z.object({
  totalDurationSeconds: z.number().positive(),
  scenes: z.array(generatedSceneSchema).min(1),
  characters: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        appearance: z.string().min(1),
        clothing: z.string().min(1),
        ageRange: z.string().min(1).max(50),
        hair: z.string().min(1),
        distinctiveFeatures: z.string().min(1),
        consistencyNotes: z.string().min(1),
      }),
    )
    .default([]),
});

export type StoryBriefInput = z.infer<typeof storyBriefSchema>;
export type GeneratedStory = z.infer<typeof generatedStorySchema>;
export type GeneratedScene = z.infer<typeof generatedSceneSchema>;
export type GeneratedScenePlan = z.infer<typeof generatedScenePlanSchema>;

export const STORY_NICHES = [
  'Motivation',
  'Business',
  'Technology',
  'Health',
  'Education',
  'Entertainment',
  'Lifestyle',
  'Finance',
] as const;

export const STORY_TONES = [
  'Inspirational',
  'Educational',
  'Dramatic',
  'Humorous',
  'Calm',
  'Urgent',
  'Cinematic',
] as const;

export const STORY_CATEGORIES = [
  'Short-form social',
  'Explainer',
  'Narrative',
  'Product story',
  'Documentary style',
] as const;
