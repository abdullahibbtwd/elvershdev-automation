import { z } from 'zod';

export const episodeScenePlanSchema = z.object({
  sceneOrder: z.number().int().min(1),
  location: z.string().min(1),
  characters: z.array(z.string().min(1)).default([]),
  action: z.string().min(1),
  visualDescription: z.string().min(1),
  dialogue: z.string().optional().default(''),
  narration: z.string().optional().default(''),
  emotionalDirection: z.string().min(1),
  shotDirection: z.string().min(1),
});

export type EpisodeScenePlan = z.infer<typeof episodeScenePlanSchema>;

export const episodeScriptPlanSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1),
  hook: z.string().min(1),
  narrationText: z.string().min(1),
  script: z.string().min(1),
  ending: z.string().min(1),
  cliffhanger: z.string().optional().default(''),
  nextEpisodeSetup: z.string().min(1),
  keyPlotDevelopment: z.string().min(1),
  emotionalBeats: z.array(z.string().min(1)).default([]),
  spokenWordCount: z.number().int().min(1),
  scenes: z.array(episodeScenePlanSchema).min(2).max(12),
  continuityChanges: z.object({
    characterStateUpdates: z
      .array(
        z.object({
          character: z.string().min(1),
          change: z.string().min(1),
        }),
      )
      .default([]),
    relationshipUpdates: z
      .array(
        z.object({
          between: z.array(z.string().min(1)).min(2).max(2),
          change: z.string().min(1),
        }),
      )
      .default([]),
    locationUpdates: z
      .array(
        z.object({
          character: z.string().min(1),
          location: z.string().min(1),
        }),
      )
      .default([]),
    objectOwnershipUpdates: z
      .array(
        z.object({
          object: z.string().min(1),
          owner: z.string().min(1),
        }),
      )
      .default([]),
    newMysteries: z.array(z.string().min(1)).default([]),
    resolvedMysteries: z.array(z.string().min(1)).default([]),
    knowledgeUpdates: z
      .array(
        z.object({
          character: z.string().min(1),
          learned: z.array(z.string().min(1)).default([]),
        }),
      )
      .default([]),
  }),
  memoryEvents: z
    .array(
      z.object({
        eventType: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        affectedCharacters: z.array(z.string().min(1)).default([]),
        importance: z.number().int().min(1).max(10).default(5),
        audienceKnows: z.boolean().default(true),
        knownByCharacters: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
});

export type EpisodeScriptPlan = z.infer<typeof episodeScriptPlanSchema>;

export const continuityIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  conflictingEvent: z.string().optional(),
  suggestedFix: z.string().optional(),
});

export type ContinuityIssue = z.infer<typeof continuityIssueSchema>;

export const continuityValidationResultSchema = z.object({
  valid: z.boolean(),
  stage: z.enum(['pre_script_approval', 'pre_visual']),
  issues: z.array(continuityIssueSchema).default([]),
  summary: z.string().min(1),
});

export type ContinuityValidationResult = z.infer<typeof continuityValidationResultSchema>;

export const continuitySnapshotStateSchema = z.object({
  characterStates: z.record(z.string()).default({}),
  relationships: z.record(z.string()).default({}),
  locations: z.record(z.string()).default({}),
  objectOwnership: z.record(z.string()).default({}),
  openMysteries: z.array(z.string()).default([]),
  knowledgeState: z
    .object({
      audience: z.array(z.string()).default([]),
      byCharacter: z.record(z.array(z.string())).default({}),
    })
    .default({ audience: [], byCharacter: {} }),
  timelineNotes: z.string().optional().default(''),
  summary: z.string().optional().default(''),
});

export type ContinuitySnapshotState = z.infer<typeof continuitySnapshotStateSchema>;
