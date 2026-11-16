import {
  applyContinuityChanges,
  createEmptyContinuitySnapshot,
  createMockEpisodeScript,
} from '@ai-video/shared';
import { ContinuityEngineService } from './continuity-engine.service';

describe('ContinuityEngineService stored validation trust', () => {
  it('trusts prior valid generation validation when local checks pass', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          episodeNumber: 1,
          title: 'Ep 1',
          synopsis: 's',
          hook: 'h',
          narrationText: 'n',
          script: 'full script text',
          ending: 'e',
          cliffhanger: 'c',
          nextEpisodeSetup: 'n',
          spokenWordCount: 120,
          continuityChanges: {
            characterStateUpdates: [],
            relationshipUpdates: [],
            locationUpdates: [],
            objectOwnershipUpdates: [],
            newMysteries: [],
            resolvedMysteries: [],
            knowledgeUpdates: [],
          },
          metadata: {
            continuityValidation: {
              valid: true,
              stage: 'pre_script_approval',
              issues: [],
              summary: 'ok at generation',
            },
          },
          scenes: [
            {
              sceneOrder: 1,
              location: 'Hall',
              characters: ['Mira Solen'],
              action: 'enters',
              visualDescription: 'v',
              dialogue: 'd',
              narration: 'n',
              emotionalDirection: 'tense',
              shotDirection: 'wide',
            },
          ],
        })),
      },
    };
    const gemini = {
      shouldUseMock: jest.fn(() => false),
      generateJson: jest.fn(async () => {
        throw new Error('Gemini should not be called when trusting stored validation');
      }),
    };
    const service = new ContinuityEngineService(prisma as never, gemini as never);
    jest.spyOn(service, 'buildCompactContext' as never).mockResolvedValue({
      series: {
        title: 'Series',
        characters: [{ name: 'Mira Solen', canonicalVisualDescription: 'human' }],
      },
      bibleDigest: '',
      characterDigest: '',
      continuityDigest: '',
      memoryDigest: '',
      snapshotState: createEmptyContinuitySnapshot(),
      memoryEvents: [],
      characterNameToId: { 'Mira Solen': 'c1' },
    } as never);

    const result = await service.validateEpisode({
      userId: 'u1',
      seriesId: 's1',
      episodeId: 'ep-1',
      stage: 'pre_script_approval',
      preferStoredValidation: true,
    });

    expect(result.valid).toBe(true);
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });
});

describe('ContinuityEngineService Gemini soft issues', () => {
  it('downgrades CHARACTER_KNOWLEDGE_LEAK errors so in-scene discovery does not fail generation', async () => {
    const prisma = {
      seriesEpisode: {
        findFirst: jest.fn(async () => ({
          id: 'ep-1',
          episodeNumber: 1,
          title: 'Ep 1',
          synopsis: 's',
          hook: 'h',
          narrationText: 'n',
          script: 'Elena learns the filing when Arthur tells her in the shed.',
          ending: 'e',
          cliffhanger: 'c',
          nextEpisodeSetup: 'n',
          spokenWordCount: 120,
          continuityChanges: {
            characterStateUpdates: [],
            relationshipUpdates: [],
            locationUpdates: [],
            objectOwnershipUpdates: [],
            newMysteries: [],
            resolvedMysteries: [],
            knowledgeUpdates: [],
          },
          metadata: {},
          scenes: [
            {
              sceneOrder: 1,
              location: 'Shed',
              characters: ['Elena Vance', 'Arthur Vance'],
              action: 'talk',
              visualDescription: 'v',
              dialogue: 'd',
              narration: 'n',
              emotionalDirection: 'tense',
              shotDirection: 'wide',
            },
          ],
        })),
      },
      providerUsage: { create: jest.fn(async () => ({})) },
    };
    const gemini = {
      shouldUseMock: jest.fn(() => false),
      generateJson: jest.fn(async () => ({
        data: {
          valid: false,
          stage: 'pre_script_approval',
          summary: 'Continuity errors detected.',
          issues: [
            {
              code: 'CHARACTER_KNOWLEDGE_LEAK',
              severity: 'error',
              message:
                'Elena Vance references Arthur filing before she inspects docs, despite the filing taking place only six minutes prior to her arrival.',
            },
            {
              code: 'CHARACTER_STATE_DISCREPANCY',
              severity: 'warning',
              message: 'Arthur is upright instead of bedridden.',
            },
          ],
        },
        usage: { model: 'mock', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
        rawText: '{}',
      })),
    };
    const service = new ContinuityEngineService(prisma as never, gemini as never);
    jest.spyOn(service, 'buildCompactContext' as never).mockResolvedValue({
      series: {
        title: 'Series',
        characters: [
          { name: 'Elena Vance', canonicalVisualDescription: 'human' },
          { name: 'Arthur Vance', canonicalVisualDescription: 'human' },
        ],
      },
      bibleDigest: '',
      characterDigest: '',
      continuityDigest: '',
      memoryDigest: '',
      snapshotState: createEmptyContinuitySnapshot(),
      memoryEvents: [],
      characterNameToId: { 'Elena Vance': 'c1', 'Arthur Vance': 'c2' },
    } as never);

    const result = await service.validateEpisode({
      userId: 'u1',
      seriesId: 's1',
      episodeId: 'ep-1',
      stage: 'pre_script_approval',
    });

    expect(result.valid).toBe(true);
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('ContinuityEngineService.runLocalChecks', () => {
  const service = Object.create(ContinuityEngineService.prototype) as ContinuityEngineService;

  it('flags unknown characters in scenes', () => {
    const plan = createMockEpisodeScript({
      episodeNumber: 1,
      title: 'Token 1',
    });
    plan.scenes[0].characters.push('Totally Unknown Person');

    const issues = service.runLocalChecks(plan, {
      snapshotState: createEmptyContinuitySnapshot(),
      series: {
        characters: [
          { name: 'Mira Solen', canonicalVisualDescription: 'human woman amber eyes' },
          { name: 'Kade Vorn', canonicalVisualDescription: 'anthropomorphic fox' },
        ],
      },
      memoryEvents: [],
      characterNameToId: {
        'Mira Solen': 'c1',
        'Kade Vorn': 'c2',
      },
    });

    expect(issues.some((i) => i.code === 'unknown_character')).toBe(true);
  });

  it('flags knowledge violations against restricted memory', () => {
    const plan = createMockEpisodeScript({
      episodeNumber: 2,
      title: 'Token 2',
    });
    plan.continuityChanges.knowledgeUpdates = [
      { character: 'Mira Solen', learned: ['mentor owns the token'] },
    ];

    const issues = service.runLocalChecks(plan, {
      snapshotState: createEmptyContinuitySnapshot(),
      series: {
        characters: [
          { name: 'Mira Solen', canonicalVisualDescription: 'human woman' },
          { name: 'Kade Vorn', canonicalVisualDescription: 'fox' },
        ],
      },
      memoryEvents: [
        {
          title: 'Hidden ownership',
          description: 'Only the mentor owns the token',
          audienceKnows: false,
          knownByCharacterIds: [],
        },
      ],
      characterNameToId: { 'Mira Solen': 'c1', 'Kade Vorn': 'c2' },
    });

    expect(issues.some((i) => i.code === 'knowledge_violation')).toBe(true);
  });
});

describe('applyContinuityChanges', () => {
  it('merges ownership and mysteries without dropping prior state', () => {
    const before = createEmptyContinuitySnapshot();
    before.objectOwnership['old key'] = 'Jonah Solen';
    before.openMysteries = ['Where is Jonah?'];

    const plan = createMockEpisodeScript({ episodeNumber: 1, title: 'Token 1' });
    const after = applyContinuityChanges(before, plan);

    expect(after.objectOwnership['old key']).toBe('Jonah Solen');
    expect(after.objectOwnership['memory fragment']).toBe('Mira Solen');
    expect(after.openMysteries).toContain('Where is Jonah?');
    expect(after.openMysteries.some((m) => m.includes('matching token'))).toBe(true);
  });
});
