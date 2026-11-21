/** Gemini responseJsonSchema subsets for Series Studio structured outputs. */

export const moviePremiseJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    synopsis: { type: 'string' },
    genre: { type: 'string' },
    subgenres: { type: 'array', items: { type: 'string' } },
    targetAudience: { type: 'string' },
    setting: { type: 'string' },
    worldRules: { type: 'string' },
    mainConflict: { type: 'string' },
    visualStyle: { type: 'string' },
  },
  required: [
    'title',
    'logline',
    'synopsis',
    'genre',
    'targetAudience',
    'setting',
    'worldRules',
    'mainConflict',
    'visualStyle',
  ],
} as const;

const characterItemJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    role: {
      type: 'string',
      enum: ['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING', 'CAMEO', 'NARRATOR'],
    },
    species: { type: 'string' },
    ageRange: { type: 'string' },
    personality: { type: 'string' },
    motivation: { type: 'string' },
    backstory: { type: 'string' },
    physicalDescription: { type: 'string' },
    facialStructure: { type: 'string' },
    eyeColor: { type: 'string' },
    eyeShape: { type: 'string' },
    hairFurColor: { type: 'string' },
    markings: { type: 'string' },
    bodyProportions: { type: 'string' },
    genderPresentation: { type: 'string' },
    skinTone: { type: 'string' },
    hairstyle: { type: 'string' },
    facialHair: { type: 'string' },
    clothing: { type: 'string' },
    accessories: { type: 'string' },
    heightRelative: { type: 'string' },
    voiceProfile: { type: 'string' },
    emotionalCharacteristics: { type: 'string' },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          withCharacter: { type: 'string' },
          relationship: { type: 'string' },
          dynamics: { type: 'string' },
        },
        required: ['withCharacter', 'relationship', 'dynamics'],
      },
    },
    secrets: { type: 'array', items: { type: 'string' } },
    flaws: { type: 'array', items: { type: 'string' } },
    canonicalVisualDescription: { type: 'string' },
    visualConsistencyNotes: { type: 'string' },
  },
  required: [
    'name',
    'role',
    'species',
    'ageRange',
    'personality',
    'motivation',
    'backstory',
    'physicalDescription',
    'facialStructure',
    'eyeColor',
    'eyeShape',
    'hairFurColor',
    'markings',
    'bodyProportions',
    'clothing',
    'accessories',
    'heightRelative',
    'voiceProfile',
    'emotionalCharacteristics',
    'canonicalVisualDescription',
    'visualConsistencyNotes',
  ],
} as const;

export const movieCharactersPlanJsonSchema = {
  type: 'object',
  properties: {
    characters: { type: 'array', items: characterItemJsonSchema },
  },
  required: ['characters'],
} as const;

export const movieArcPlanJsonSchema = {
  type: 'object',
  properties: {
    premise: { type: 'string' },
    masterPlot: { type: 'string' },
    beginning: { type: 'string' },
    middle: { type: 'string' },
    climax: { type: 'string' },
    resolution: { type: 'string' },
    ending: { type: 'string' },
    majorConflicts: { type: 'string' },
    secrets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          secret: { type: 'string' },
          audienceKnows: { type: 'boolean' },
          knownByCharacters: { type: 'array', items: { type: 'string' } },
          unawareCharacters: { type: 'array', items: { type: 'string' } },
          revealEpisode: { type: 'number' },
        },
        required: ['id', 'secret', 'audienceKnows'],
      },
    },
    reveals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          episodeNumber: { type: 'number' },
          reveal: { type: 'string' },
          payoffOf: { type: 'string' },
        },
        required: ['episodeNumber', 'reveal'],
      },
    },
    foreshadowingMap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          plantEpisode: { type: 'number' },
          payoffEpisode: { type: 'number' },
          detail: { type: 'string' },
        },
        required: ['plantEpisode', 'payoffEpisode', 'detail'],
      },
    },
    characterArcs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          character: { type: 'string' },
          startingState: { type: 'string' },
          endingState: { type: 'string' },
          keyTurningPoints: { type: 'array', items: { type: 'string' } },
        },
        required: ['character', 'startingState', 'endingState'],
      },
    },
    knowledgeMap: {
      type: 'object',
      properties: {
        audience: { type: 'array', items: { type: 'string' } },
        byCharacter: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character: { type: 'string' },
              knows: { type: 'array', items: { type: 'string' } },
              doesNotKnow: { type: 'array', items: { type: 'string' } },
            },
            required: ['character'],
          },
        },
      },
    },
  },
  required: [
    'premise',
    'masterPlot',
    'beginning',
    'middle',
    'climax',
    'resolution',
    'ending',
    'majorConflicts',
  ],
} as const;

export const episodeOutlinesBatchJsonSchema = {
  type: 'object',
  properties: {
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          episodeNumber: { type: 'number' },
          title: { type: 'string' },
          synopsis: { type: 'string' },
          hook: { type: 'string' },
          keyPlotDevelopment: { type: 'string' },
          emotionalBeat: { type: 'string' },
          cliffhangerOrEnding: { type: 'string' },
          nextEpisodeSetup: { type: 'string' },
          charactersFeatured: { type: 'array', items: { type: 'string' } },
          reveals: { type: 'array', items: { type: 'string' } },
          continuityNotes: { type: 'string' },
        },
        required: [
          'episodeNumber',
          'title',
          'synopsis',
          'hook',
          'keyPlotDevelopment',
          'emotionalBeat',
          'cliffhangerOrEnding',
          'nextEpisodeSetup',
          'continuityNotes',
        ],
      },
    },
  },
  required: ['episodes'],
} as const;

export const storyQualityScoreJsonSchema = {
  type: 'object',
  properties: {
    originality: { type: 'number' },
    characterDepth: { type: 'number' },
    emotionalEngagement: { type: 'number' },
    suspense: { type: 'number' },
    plotCoherence: { type: 'number' },
    episodeProgression: { type: 'number' },
    cliffhangerPayoffQuality: { type: 'number' },
    dialoguePotential: { type: 'number' },
    continuity: { type: 'number' },
    completeStoryResolution: { type: 'number' },
    overall: { type: 'number' },
    explanations: { type: 'object', additionalProperties: { type: 'string' } },
    accepted: { type: 'boolean' },
    rejectionReasons: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: [
    'originality',
    'characterDepth',
    'emotionalEngagement',
    'suspense',
    'plotCoherence',
    'episodeProgression',
    'cliffhangerPayoffQuality',
    'dialoguePotential',
    'continuity',
    'completeStoryResolution',
    'overall',
    'accepted',
  ],
} as const;
