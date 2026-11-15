/** JSON Schema subset for Gemini `responseJsonSchema` (social caption). */
export const captionSuggestionResultJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    caption: { type: 'string' },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['caption', 'hashtags'],
} as const;
