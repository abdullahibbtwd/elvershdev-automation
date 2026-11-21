import { createMockDialogueEpisodeScript } from './dialogue-mocks';
import { dialoguePlanToEpisodeScriptPlan } from './dialogue-compat';
import {
  flattenDialogueLines,
  validateDialogueSpeakers,
  dialogueEpisodeScriptPlanSchema,
} from './dialogue-schemas';
import { normalizeDialogueEpisodeScriptPlanInput } from './dialogue-normalize';

describe('dialogue episode schemas', () => {
  it('validates mock dialogue script with two speakers', () => {
    const plan = dialogueEpisodeScriptPlanSchema.parse(
      createMockDialogueEpisodeScript({ episodeNumber: 1 }),
    );
    const lines = flattenDialogueLines(plan);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const errors = validateDialogueSpeakers(plan, ['Tunde', 'Kemi', 'Ada', 'Mother']);
    expect(errors).toEqual([]);
  });

  it('rejects unknown speakers', () => {
    const plan = createMockDialogueEpisodeScript({ episodeNumber: 1 });
    const errors = validateDialogueSpeakers(plan, ['Kemi']);
    expect(errors.some((e) => e.includes('unknown speaker'))).toBe(true);
  });

  it('normalizes snake_case shot fields', () => {
    const normalized = normalizeDialogueEpisodeScriptPlanInput({
      episodeNumber: 1,
      title: 'Test',
      synopsis: 's',
      hook: 'h',
      ending: 'e',
      nextEpisodeSetup: 'n',
      keyPlotDevelopment: 'k',
      spokenWordCount: 10,
      script: 'A: hi\nB: hello',
      scenes: [
        {
          scene_number: 1,
          duration_seconds: 10,
          location: 'Room',
          characters: ['A', 'B'],
          background_environment: 'Room',
          emotional_direction: 'tense',
          action: 'talk',
          visual_description: '3d',
          shots: [
            {
              shot_order: 1,
              shot_type: 'close_up',
              speaker: 'A',
              dialogue: 'hi',
              emotion: 'calm',
              facial_expression: 'soft',
              body_language: 'still',
              camera_direction: 'close',
              characters_visible: ['A'],
              environment: 'Room',
              duration_seconds: 3,
            },
            {
              shot_order: 2,
              speaker: 'B',
              dialogue: 'hello',
              emotion: 'calm',
              facialExpression: 'open',
              bodyLanguage: 'nod',
              cameraDirection: 'reverse',
              charactersVisible: ['B'],
              environment: 'Room',
              durationSeconds: 3,
            },
          ],
        },
        {
          sceneNumber: 2,
          durationSeconds: 8,
          location: 'Hall',
          characters: ['A', 'B'],
          backgroundEnvironment: 'Hall',
          emotionalDirection: 'resolve',
          action: 'leave',
          visualDescription: '3d',
          shots: [
            {
              shotOrder: 1,
              speaker: 'A',
              dialogue: 'we talk later',
              emotion: 'calm',
              facialExpression: 'firm',
              bodyLanguage: 'turn',
              cameraDirection: 'medium',
              charactersVisible: ['A'],
              environment: 'Hall',
              durationSeconds: 4,
            },
          ],
        },
      ],
      continuityChanges: {},
      memoryEvents: [],
    });
    expect(normalized.scenes[0]!.shots[0]!.speaker).toBe('A');
    expect(normalized.scenes).toHaveLength(2);
  });

  it('adapts dialogue plan to legacy episode script plan', () => {
    const dialogue = createMockDialogueEpisodeScript({ episodeNumber: 2 });
    const legacy = dialoguePlanToEpisodeScriptPlan(dialogue);
    expect(legacy.episodeNumber).toBe(2);
    expect(legacy.scenes.length).toBeGreaterThanOrEqual(2);
    expect(legacy.scenes[0]!.dialogue).toContain('Tunde:');
  });

  it('accepts reaction shots with empty speaker and drops broken continuity rows', () => {
    const normalized = normalizeDialogueEpisodeScriptPlanInput({
      episodeNumber: 1,
      title: 'Test',
      synopsis: 's',
      hook: 'h',
      ending: 'e',
      nextEpisodeSetup: 'n',
      keyPlotDevelopment: 'k',
      spokenWordCount: 8,
      script: 'A: hi\nB: hello',
      scenes: [
        {
          sceneNumber: 1,
          durationSeconds: 10,
          location: 'Room',
          characters: ['A', 'B'],
          backgroundEnvironment: 'Room',
          emotionalDirection: 'tense',
          action: 'talk',
          visualDescription: '3d',
          shots: [
            {
              shotOrder: 1,
              speaker: 'A',
              dialogue: 'hi',
              emotion: 'calm',
              facialExpression: 'soft',
              bodyLanguage: 'still',
              cameraDirection: 'close',
              charactersVisible: ['A'],
              environment: 'Room',
              durationSeconds: 3,
              requiresLipSync: true,
            },
            {
              shotOrder: 2,
              speaker: '',
              dialogue: '',
              shotType: 'reaction',
              emotion: 'hurt',
              facialExpression: 'flinch',
              bodyLanguage: 'freeze',
              cameraDirection: 'close on B',
              charactersVisible: ['B'],
              environment: 'Room',
              durationSeconds: 2,
              requiresLipSync: false,
            },
          ],
        },
        {
          sceneNumber: 2,
          durationSeconds: 8,
          location: 'Hall',
          characters: ['A', 'B'],
          backgroundEnvironment: 'Hall',
          emotionalDirection: 'resolve',
          action: 'leave',
          visualDescription: '3d',
          shots: [
            {
              shotOrder: 1,
              speaker: 'B',
              dialogue: 'hello',
              emotion: 'calm',
              facialExpression: 'open',
              bodyLanguage: 'nod',
              cameraDirection: 'medium',
              charactersVisible: ['B'],
              environment: 'Hall',
              durationSeconds: 4,
              requiresLipSync: true,
            },
          ],
        },
      ],
      continuityChanges: {
        characterStateUpdates: [{}, { character: 'A', change: 'ashamed' }],
        relationshipUpdates: [{}, { between: ['A', 'B'], change: 'tense' }],
        locationUpdates: [{ character: 'A' }],
        objectOwnershipUpdates: [{ object: 'key' }],
        knowledgeUpdates: [{ learned: ['secret'] }, { character: 'B', learned: ['truth'] }],
      },
      memoryEvents: [],
    });

    expect(normalized.scenes[0]!.shots[1]!.speaker).toBe('B');
    expect(normalized.scenes[0]!.shots[1]!.dialogue).toBe('');
    expect(normalized.continuityChanges.characterStateUpdates).toEqual([
      { character: 'A', change: 'ashamed' },
    ]);
    expect(normalized.continuityChanges.relationshipUpdates).toEqual([
      { between: ['A', 'B'], change: 'tense' },
    ]);
    expect(normalized.continuityChanges.locationUpdates).toEqual([]);
    expect(normalized.continuityChanges.objectOwnershipUpdates).toEqual([]);
    expect(normalized.continuityChanges.knowledgeUpdates).toEqual([
      { character: 'B', learned: ['truth'] },
    ]);
  });
});
