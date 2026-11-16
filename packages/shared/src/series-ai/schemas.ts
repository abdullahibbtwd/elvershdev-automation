import { z } from 'zod';

export const movieArchitectBriefSchema = z.object({
  genre: z.string().min(2).max(100).default('Cinematic drama'),
  subgenres: z.array(z.string().min(1).max(80)).max(8).default([]),
  theme: z.string().min(2).max(300).optional(),
  targetAudience: z.string().min(2).max(200).default('Adult viewers who enjoy premium serialized drama'),
  language: z.string().min(2).max(10).default('en'),
  tone: z.string().min(2).max(100).default('Cinematic drama'),
  visualDirection: z
    .string()
    .min(2)
    .max(500)
    .default('Mature premium cinematic 3D animation, not children’s cartoon aesthetics'),
  plannedEpisodeCount: z.number().int().min(2).max(120).default(10),
  targetEpisodeDurationSeconds: z.number().int().min(15).max(600).default(60),
  additionalInstructions: z.string().max(8000).optional(),
  /** Option B: user-supplied premise/concept the AI must expand into a full movie plan. */
  customPremise: z.string().max(12000).optional(),
  ideaMode: z.enum(['generate', 'custom']).default('generate'),
});

export type MovieArchitectBrief = z.infer<typeof movieArchitectBriefSchema>;

export const moviePremiseSchema = z.object({
  title: z.string().min(1).max(200),
  logline: z.string().min(1).max(500),
  synopsis: z.string().min(1),
  genre: z.string().min(1).max(100),
  subgenres: z.array(z.string().min(1).max(80)).max(8).default([]),
  targetAudience: z.string().min(1).max(200),
  setting: z.string().min(1),
  worldRules: z.string().min(1),
  mainConflict: z.string().min(1),
  visualStyle: z.string().min(1),
});

export type MoviePremise = z.infer<typeof moviePremiseSchema>;

export const seriesCharacterPlanSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING', 'CAMEO', 'NARRATOR']),
  species: z.string().min(1).max(100),
  ageRange: z.string().min(1).max(50),
  personality: z.string().min(1),
  motivation: z.string().min(1),
  backstory: z.string().min(1),
  physicalDescription: z.string().min(1),
  facialStructure: z.string().min(1),
  eyeColor: z.string().min(1).max(80),
  eyeShape: z.string().min(1).max(80),
  hairFurColor: z.string().min(1).max(120),
  markings: z.string().min(1),
  bodyProportions: z.string().min(1),
  clothing: z.string().min(1),
  accessories: z.string().min(1),
  heightRelative: z.string().min(1).max(200),
  voiceProfile: z.string().min(1),
  emotionalCharacteristics: z.string().min(1),
  relationships: z
    .array(
      z.object({
        withCharacter: z.string().min(1),
        relationship: z.string().min(1),
        dynamics: z.string().min(1),
      }),
    )
    .default([]),
  secrets: z.array(z.string().min(1)).default([]),
  flaws: z.array(z.string().min(1)).default([]),
  canonicalVisualDescription: z.string().min(1),
  visualConsistencyNotes: z.string().min(1),
});

export type SeriesCharacterPlan = z.infer<typeof seriesCharacterPlanSchema>;

export const movieCharactersPlanSchema = z.object({
  characters: z.array(seriesCharacterPlanSchema).min(2).max(20),
});

export type MovieCharactersPlan = z.infer<typeof movieCharactersPlanSchema>;

export const secretKnowledgeSchema = z.object({
  id: z.string().min(1).max(80),
  secret: z.string().min(1),
  audienceKnows: z.boolean(),
  knownByCharacters: z.array(z.string().min(1)).default([]),
  unawareCharacters: z.array(z.string().min(1)).default([]),
  revealEpisode: z.number().int().min(1).optional(),
});

export const movieArcPlanSchema = z.object({
  premise: z.string().min(1),
  masterPlot: z.string().min(1),
  beginning: z.string().min(1),
  middle: z.string().min(1),
  climax: z.string().min(1),
  resolution: z.string().min(1),
  ending: z.string().min(1),
  majorConflicts: z.string().min(1),
  secrets: z.array(secretKnowledgeSchema).default([]),
  reveals: z
    .array(
      z.object({
        episodeNumber: z.number().int().min(1),
        reveal: z.string().min(1),
        payoffOf: z.string().min(1).optional(),
      }),
    )
    .default([]),
  foreshadowingMap: z
    .array(
      z.object({
        plantEpisode: z.number().int().min(1),
        payoffEpisode: z.number().int().min(1),
        detail: z.string().min(1),
      }),
    )
    .default([]),
  characterArcs: z
    .array(
      z.object({
        character: z.string().min(1),
        startingState: z.string().min(1),
        endingState: z.string().min(1),
        keyTurningPoints: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  knowledgeMap: z
    .object({
      audience: z.array(z.string().min(1)).default([]),
      byCharacter: z
        .array(
          z.object({
            character: z.string().min(1),
            knows: z.array(z.string().min(1)).default([]),
            doesNotKnow: z.array(z.string().min(1)).default([]),
          }),
        )
        .default([]),
    })
    .default({ audience: [], byCharacter: [] }),
});

export type MovieArcPlan = z.infer<typeof movieArcPlanSchema>;

export const episodeOutlineSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1),
  hook: z.string().min(1),
  keyPlotDevelopment: z.string().min(1),
  emotionalBeat: z.string().min(1),
  cliffhangerOrEnding: z.string().min(1),
  nextEpisodeSetup: z.string().min(1),
  charactersFeatured: z.array(z.string().min(1)).default([]),
  reveals: z.array(z.string().min(1)).default([]),
  continuityNotes: z.string().min(1),
});

export type EpisodeOutline = z.infer<typeof episodeOutlineSchema>;

export const episodeOutlinesBatchSchema = z.object({
  episodes: z.array(episodeOutlineSchema).min(1).max(20),
});

export type EpisodeOutlinesBatch = z.infer<typeof episodeOutlinesBatchSchema>;

export const storyQualityScoreSchema = z.object({
  originality: z.number().min(0).max(1),
  characterDepth: z.number().min(0).max(1),
  emotionalEngagement: z.number().min(0).max(1),
  suspense: z.number().min(0).max(1),
  plotCoherence: z.number().min(0).max(1),
  episodeProgression: z.number().min(0).max(1),
  cliffhangerPayoffQuality: z.number().min(0).max(1),
  dialoguePotential: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  completeStoryResolution: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  explanations: z.record(z.string()).default({}),
  accepted: z.boolean(),
  rejectionReasons: z.array(z.string()).default([]),
  /** Explicitly not a virality prediction */
  note: z
    .string()
    .default(
      'Scores measure story craft only. They do not predict audience reach or viral performance.',
    ),
});

export type StoryQualityScore = z.infer<typeof storyQualityScoreSchema>;

export const completeMoviePlanSchema = z.object({
  premise: moviePremiseSchema,
  characters: z.array(seriesCharacterPlanSchema).min(2),
  arc: movieArcPlanSchema,
  episodeOutlines: z.array(episodeOutlineSchema).min(2),
  quality: storyQualityScoreSchema,
});

export type CompleteMoviePlan = z.infer<typeof completeMoviePlanSchema>;
