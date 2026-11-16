import { SERIES_DEFAULTS } from '../series/constants';
import type {
  ContinuitySnapshotState,
  ContinuityValidationResult,
  EpisodeScriptPlan,
} from './episode-schemas';
import { countSpokenWords } from './episode-normalize';

export function createMockEpisodeScript(input: {
  episodeNumber: number;
  title: string;
  synopsis?: string | null;
  targetDurationSeconds?: number;
}): EpisodeScriptPlan {
  const duration = input.targetDurationSeconds ?? SERIES_DEFAULTS.targetEpisodeDurationSeconds;
  const targetWords = Math.round(
    ((SERIES_DEFAULTS.spokenWordsPerSixtySecondsMin +
      SERIES_DEFAULTS.spokenWordsPerSixtySecondsMax) /
      2) *
      (duration / 60),
  );

  const narrationText = [
    `Rain needles the flooded district as Mira studies the glass fragment from episode ${input.episodeNumber}.`,
    'A voice on the rail line whispers a name she thought was buried.',
    'Kade appears with a deal that smells like survival and betrayal.',
    'She chooses the harder path: truth before comfort.',
    'The fragment brightens, and a new door opens on the next night.',
  ].join(' ');

  const padded = `${narrationText} ${'The city listens. '.repeat(Math.max(1, Math.ceil((targetWords - countSpokenWords(narrationText)) / 3)))}`.trim();
  const spokenWordCount = countSpokenWords(padded);

  return {
    episodeNumber: input.episodeNumber,
    title: input.title,
    synopsis:
      input.synopsis ??
      `Episode ${input.episodeNumber} tightens the hunt for the locked token and tests Mira's trust in Kade.`,
    hook: 'A corrupted fragment whispers a living name in the dark.',
    narrationText: padded,
    script: [
      'SCENE 1 — Flooded arcade',
      'MIRA: This fragment still carries his breath.',
      'KADE: Then stop staring and move before the syndicate does.',
      '',
      'SCENE 2 — Elevated rail',
      'MIRA: You knew this route. Do not lie to me again.',
      'KADE: I sell maps. Tonight I sell you a way out.',
      '',
      'SCENE 3 — Rooftop seal',
      'MIRA: If this opens, someone I love falls.',
      'Narration: She opens it anyway.',
    ].join('\n'),
    ending: 'Mira locks the fragment into her pendant and names the next district.',
    cliffhanger: 'A silhouette on the far rail holds an identical token.',
    nextEpisodeSetup: 'Find the matching token before dawn.',
    keyPlotDevelopment: `Mira confirms Jonah left an active trail in episode ${input.episodeNumber}.`,
    emotionalBeats: ['dread', 'distrust', 'resolve'],
    spokenWordCount,
    scenes: [
      {
        sceneOrder: 1,
        location: 'Flooded arcade under neon rail lines',
        characters: ['Mira Solen', 'Kade Vorn'],
        action: 'Mira inspects the glass fragment while Kade watches the exits.',
        visualDescription:
          'Cinematic 3D night scene, reflective floodwater, amber-brown eyes catching neon, charcoal coat',
        dialogue: 'MIRA: This fragment still carries his breath.',
        narration: 'Rain needles the flooded district.',
        emotionalDirection: 'Tight focus, controlled fear',
        shotDirection: 'Slow push-in on pendant and fragment',
      },
      {
        sceneOrder: 2,
        location: 'Elevated coastal rail platform',
        characters: ['Mira Solen', 'Kade Vorn'],
        action: 'They argue about forged maps while scanning for pursuers.',
        visualDescription:
          'Anthropomorphic fox Kade in olive vest beside Mira, wet metal rails, mature dramatic lighting',
        dialogue: 'KADE: Tonight I sell you a way out.',
        narration: 'A deal that smells like survival and betrayal.',
        emotionalDirection: 'Friction under loyalty',
        shotDirection: 'Lateral tracking shot along the platform edge',
      },
      {
        sceneOrder: 3,
        location: 'Rooftop estate seal chamber',
        characters: ['Mira Solen'],
        action: 'Mira almost seals the fragment, then chooses to keep hunting.',
        visualDescription:
          'Premium cinematic 3D close-up of Mira, silver pendant, storm city beyond glass',
        dialogue: 'MIRA: If this opens, someone I love falls.',
        narration: 'She opens it anyway.',
        emotionalDirection: 'Quiet courage',
        shotDirection: 'Static close-up then cut to distant silhouette',
      },
    ],
    continuityChanges: {
      characterStateUpdates: [
        { character: 'Mira Solen', change: 'Carries active fragment sealed in pendant' },
        { character: 'Kade Vorn', change: 'Still indebted but cooperating for now' },
      ],
      relationshipUpdates: [
        {
          between: ['Mira Solen', 'Kade Vorn'],
          change: 'Fragile alliance under open distrust',
        },
      ],
      locationUpdates: [
        { character: 'Mira Solen', location: 'Rooftop estate seal chamber' },
        { character: 'Kade Vorn', location: 'Elevated coastal rail platform' },
      ],
      objectOwnershipUpdates: [
        { object: 'memory fragment', owner: 'Mira Solen' },
      ],
      newMysteries: ['Who holds the matching token silhouette?'],
      resolvedMysteries: [],
      knowledgeUpdates: [
        {
          character: 'Mira Solen',
          learned: ['Jonah left an active trail'],
        },
      ],
    },
    memoryEvents: [
      {
        eventType: 'object_ownership_changed',
        title: 'Fragment sealed in pendant',
        description: 'Mira secures the active memory fragment inside her silver pendant.',
        affectedCharacters: ['Mira Solen'],
        importance: 7,
        audienceKnows: true,
        knownByCharacters: ['Mira Solen', 'Kade Vorn'],
      },
      {
        eventType: 'mystery_opened',
        title: 'Matching token silhouette',
        description: 'A distant figure appears holding a second identical token.',
        affectedCharacters: ['Mira Solen'],
        importance: 8,
        audienceKnows: true,
        knownByCharacters: ['Mira Solen'],
      },
    ],
  };
}

export function createMockContinuityValidation(
  stage: 'pre_script_approval' | 'pre_visual',
  valid = true,
): ContinuityValidationResult {
  return {
    valid,
    stage,
    issues: valid
      ? []
      : [
          {
            code: 'knowledge_violation',
            severity: 'error',
            message: 'A character speaks of a secret they have not discovered.',
            conflictingEvent: 'Prior memory: secret still restricted',
            suggestedFix: 'Remove the knowing dialogue or delay the reveal.',
          },
        ],
    summary: valid
      ? 'No continuity errors detected for this episode draft.'
      : 'Continuity errors must be fixed before approval.',
  };
}

export function createEmptyContinuitySnapshot(summary = 'Initial series state'): ContinuitySnapshotState {
  return {
    characterStates: {},
    relationships: {},
    locations: {},
    objectOwnership: {},
    openMysteries: [],
    knowledgeState: { audience: [], byCharacter: {} },
    timelineNotes: '',
    summary,
  };
}
