/** JSON Schema subset for Gemini `responseJsonSchema` (story generation). */
export const generatedStoryJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Compelling short-form video title' },
    story: { type: 'string', description: 'Full original story narrative' },
    openingHook: { type: 'string', description: 'Strong opening hook' },
    narrationScript: { type: 'string', description: 'Voiceover narration script' },
    closingMessage: { type: 'string', description: 'Closing message / takeaway' },
    description: { type: 'string', description: 'Short social post description' },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Hashtags without # prefix',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          appearance: { type: 'string', description: 'Flat string, not nested object' },
          clothing: { type: 'string' },
          ageRange: { type: 'string' },
          hair: { type: 'string' },
          distinctiveFeatures: { type: 'string' },
          consistencyNotes: { type: 'string' },
        },
        required: [
          'name',
          'appearance',
          'clothing',
          'ageRange',
          'hair',
          'distinctiveFeatures',
          'consistencyNotes',
        ],
      },
    },
  },
  required: [
    'title',
    'story',
    'openingHook',
    'narrationScript',
    'closingMessage',
    'description',
    'hashtags',
  ],
} as const;

/** JSON Schema subset for Gemini `responseJsonSchema` (scene planning). */
export const generatedScenePlanJsonSchema = {
  type: 'object',
  properties: {
    totalDurationSeconds: { type: 'number' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sceneNumber: { type: 'number' },
          durationSeconds: { type: 'number' },
          narration: { type: 'string' },
          visualDescription: { type: 'string' },
          imagePrompt: { type: 'string' },
          videoPrompt: { type: 'string' },
          cameraMovement: { type: 'string', description: 'Flat string, not object' },
          lighting: { type: 'string', description: 'Flat string, not object' },
          environment: { type: 'string', description: 'Flat string, not object' },
          characterConsistencyInstructions: { type: 'string' },
        },
        required: [
          'sceneNumber',
          'durationSeconds',
          'narration',
          'visualDescription',
          'imagePrompt',
          'videoPrompt',
          'cameraMovement',
          'lighting',
          'environment',
          'characterConsistencyInstructions',
        ],
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          appearance: { type: 'string' },
          clothing: { type: 'string' },
          ageRange: { type: 'string' },
          hair: { type: 'string' },
          distinctiveFeatures: { type: 'string' },
          consistencyNotes: { type: 'string' },
        },
        required: [
          'name',
          'appearance',
          'clothing',
          'ageRange',
          'hair',
          'distinctiveFeatures',
          'consistencyNotes',
        ],
      },
    },
  },
  required: ['totalDurationSeconds', 'scenes'],
} as const;
