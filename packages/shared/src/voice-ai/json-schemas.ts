/** JSON Schema subset for Gemini `responseJsonSchema` (narration planning). */
export const plannedNarrationScriptJsonSchema = {
  type: 'object',
  properties: {
    fullText: { type: 'string' },
    notes: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sceneId: { type: 'string' },
          sceneNumber: { type: 'number' },
          text: { type: 'string' },
          emotionalTone: { type: 'string' },
          speakingStyle: { type: 'string' },
          deliveryInstructions: { type: 'string' },
          pronunciationGuidance: { type: 'string' },
          estimatedDurationSeconds: { type: 'number' },
          sequence: { type: 'number' },
        },
        required: [
          'sceneNumber',
          'text',
          'emotionalTone',
          'speakingStyle',
          'estimatedDurationSeconds',
          'sequence',
        ],
      },
    },
  },
  required: ['fullText', 'scenes'],
} as const;
