export const episodeScriptPlanJsonSchema = {
  type: 'object',
  properties: {
    episodeNumber: { type: 'number' },
    title: { type: 'string' },
    synopsis: { type: 'string' },
    hook: { type: 'string' },
    narrationText: { type: 'string' },
    script: { type: 'string' },
    ending: { type: 'string' },
    cliffhanger: { type: 'string' },
    nextEpisodeSetup: { type: 'string' },
    keyPlotDevelopment: { type: 'string' },
    emotionalBeats: { type: 'array', items: { type: 'string' } },
    spokenWordCount: { type: 'number' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sceneOrder: { type: 'number' },
          location: { type: 'string' },
          characters: { type: 'array', items: { type: 'string' } },
          action: { type: 'string' },
          visualDescription: { type: 'string' },
          dialogue: { type: 'string' },
          narration: { type: 'string' },
          emotionalDirection: { type: 'string' },
          shotDirection: { type: 'string' },
        },
        required: [
          'sceneOrder',
          'location',
          'action',
          'visualDescription',
          'emotionalDirection',
          'shotDirection',
        ],
      },
    },
    continuityChanges: {
      type: 'object',
      properties: {
        characterStateUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character: { type: 'string' },
              change: { type: 'string' },
            },
            required: ['character', 'change'],
          },
        },
        relationshipUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              between: { type: 'array', items: { type: 'string' } },
              change: { type: 'string' },
            },
            required: ['between', 'change'],
          },
        },
        locationUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character: { type: 'string' },
              location: { type: 'string' },
            },
            required: ['character', 'location'],
          },
        },
        objectOwnershipUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              object: { type: 'string' },
              owner: { type: 'string' },
            },
            required: ['object', 'owner'],
          },
        },
        newMysteries: { type: 'array', items: { type: 'string' } },
        resolvedMysteries: { type: 'array', items: { type: 'string' } },
        knowledgeUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character: { type: 'string' },
              learned: { type: 'array', items: { type: 'string' } },
            },
            required: ['character'],
          },
        },
      },
    },
    memoryEvents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventType: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          affectedCharacters: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number' },
          audienceKnows: { type: 'boolean' },
          knownByCharacters: { type: 'array', items: { type: 'string' } },
        },
        required: ['eventType', 'title', 'description'],
      },
    },
  },
  required: [
    'episodeNumber',
    'title',
    'synopsis',
    'hook',
    'narrationText',
    'script',
    'ending',
    'nextEpisodeSetup',
    'keyPlotDevelopment',
    'spokenWordCount',
    'scenes',
    'continuityChanges',
  ],
} as const;

export const continuityValidationResultJsonSchema = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    stage: { type: 'string', enum: ['pre_script_approval', 'pre_visual'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning'] },
          message: { type: 'string' },
          conflictingEvent: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['code', 'severity', 'message'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['valid', 'stage', 'summary'],
} as const;
