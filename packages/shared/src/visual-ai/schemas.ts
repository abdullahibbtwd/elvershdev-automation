import { z } from 'zod';

export const visualStyleConfigurationSchema = z.object({
  lighting: z.string().min(1),
  colorTreatment: z.string().min(1),
  camera: z.string().min(1),
  composition: z.string().min(1),
  imageGenerationInstructions: z.string().min(1),
  avoid: z.array(z.string()).default(['cartoon', 'illustration', 'anime', 'cgi render']),
});

export const createVisualStyleSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(1).max(2000),
  configuration: visualStyleConfigurationSchema,
  isDefault: z.boolean().optional(),
});

export const updateVisualStyleSchema = createVisualStyleSchema.partial();

export const sceneVisualAnalysisSchema = z.object({
  mainSubject: z.string().min(1),
  charactersPresent: z.array(z.string()).default([]),
  characterAppearances: z
    .array(
      z.object({
        name: z.string().min(1),
        appearance: z.string().min(1),
        clothing: z.string().min(1),
        ageRange: z.string().optional(),
        facialExpression: z.string().min(1),
        bodyPosture: z.string().min(1),
        physicalAction: z.string().min(1),
      }),
    )
    .default([]),
  location: z.string().min(1),
  environment: z.string().min(1),
  timeOfDay: z.string().min(1),
  weather: z.string().min(1),
  lighting: z.string().min(1),
  cameraAngle: z.string().min(1),
  cameraDistance: z.string().min(1),
  composition: z.string().min(1),
  backgroundDetails: z.string().min(1),
  emotionalAtmosphere: z.string().min(1),
  visualStyleNotes: z.string().min(1),
  aspectRatio: z.string().min(1).default('9:16'),
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
});

export const characterCanonicalVisualSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  approximateAge: z.string().min(1),
  genderPresentation: z.string().optional(),
  skinTone: z.string().optional(),
  facialFeatures: z.string().min(1),
  hairstyle: z.string().min(1),
  hairColor: z.string().min(1),
  bodyBuild: z.string().optional(),
  clothing: z.string().min(1),
  accessories: z.string().optional(),
  distinguishingCharacteristics: z.string().min(1),
  visualConsistencyInstructions: z.string().min(1),
  canonicalVisualDescription: z.string().min(1),
});

export const visualAnalysisBatchSchema = z.object({
  characters: z.array(characterCanonicalVisualSchema).default([]),
  scenes: z
    .array(
      sceneVisualAnalysisSchema.extend({
        sceneNumber: z.number().int().min(1),
      }),
    )
    .min(1),
});

export const generateStoryVisualsSchema = z.object({
  visualStyleId: z.string().uuid().optional(),
  sceneIds: z.array(z.string().uuid()).optional(),
  skipCharacterReferences: z.boolean().optional(),
  regeneratePrompts: z.boolean().optional(),
  simulateFailure: z.boolean().optional(),
});

export const generateSceneVisualSchema = z.object({
  visualStyleId: z.string().uuid().optional(),
  visualPrompt: z.string().min(1).max(8000).optional(),
  negativePrompt: z.string().max(4000).optional(),
  regeneratePrompt: z.boolean().optional(),
  simulateFailure: z.boolean().optional(),
});

export const updateSceneVisualSchema = z.object({
  visualPrompt: z.string().min(1).max(8000).optional(),
  negativePrompt: z.string().max(4000).optional(),
  isSelected: z.boolean().optional(),
});

export const generateCharacterReferenceSchema = z.object({
  force: z.boolean().optional(),
  simulateFailure: z.boolean().optional(),
});

export type VisualStyleConfiguration = z.infer<typeof visualStyleConfigurationSchema>;
export type CreateVisualStyleInput = z.infer<typeof createVisualStyleSchema>;
export type UpdateVisualStyleInput = z.infer<typeof updateVisualStyleSchema>;
export type SceneVisualAnalysis = z.infer<typeof sceneVisualAnalysisSchema>;
export type CharacterCanonicalVisual = z.infer<typeof characterCanonicalVisualSchema>;
export type VisualAnalysisBatch = z.infer<typeof visualAnalysisBatchSchema>;
export type GenerateStoryVisualsInput = z.infer<typeof generateStoryVisualsSchema>;
export type GenerateSceneVisualInput = z.infer<typeof generateSceneVisualSchema>;
export type UpdateSceneVisualInput = z.infer<typeof updateSceneVisualSchema>;
export type GenerateCharacterReferenceInput = z.infer<typeof generateCharacterReferenceSchema>;

export type VisualJobAction =
  | 'analyze_story_visuals'
  | 'generate_character_references'
  | 'generate_scene_image'
  | 'regenerate_scene_image'
  | 'generate_character_reference';
