import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  function createProvider(env: Record<string, string | undefined> = {}) {
    const config = {
      get: (key: string, defaultValue?: unknown) => {
        const map: Record<string, unknown> = {
          'integrations.geminiApiKey': env.GEMINI_API_KEY,
          'integrations.geminiUseMock': env.GEMINI_USE_MOCK,
          'integrations.geminiModel': env.GEMINI_MODEL ?? 'gemini-2.0-flash',
          'integrations.geminiTimeoutMs': 60_000,
          'integrations.geminiMaxRetries': 3,
        };
        return map[key] ?? defaultValue;
      },
    } as ConfigService;

    return new GeminiProvider(config);
  }

  const brief = {
    topic: 'Never give up on your vision',
    niche: 'Motivation',
    targetAudience: 'Creators',
    language: 'en',
    tone: 'Inspirational',
    desiredDurationSeconds: 60,
    category: 'Narrative',
  };

  it('uses mock mode when API key is missing', async () => {
    process.env.NODE_ENV = 'test';
    const provider = createProvider({});
    expect(provider.shouldUseMock()).toBe(true);

    const result = await provider.generateStoryContent(brief);
    expect(result.data.title).toContain('Motivation');
    expect(result.data.characters.length).toBeGreaterThan(0);
    expect(result.usage.model).toBe('mock-gemini');
    expect(result.usage.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('plans scenes with durations near the requested total', async () => {
    const provider = createProvider({ GEMINI_USE_MOCK: 'true' });
    const story = await provider.generateStoryContent(brief);
    const plan = await provider.planScenes({ brief, story: story.data });

    const total = plan.data.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    expect(Math.abs(total - brief.desiredDurationSeconds) / brief.desiredDurationSeconds).toBeLessThanOrEqual(
      0.15,
    );
    expect(plan.data.scenes[0]?.characterConsistencyInstructions).toBeTruthy();
  });

  it('keeps character identity consistent across mock scenes', async () => {
    const provider = createProvider({ GEMINI_USE_MOCK: 'true' });
    const story = await provider.generateStoryContent(brief);
    const character = story.data.characters[0];
    expect(character).toBeDefined();

    const plan = await provider.planScenes({ brief, story: story.data });
    for (const scene of plan.data.scenes) {
      expect(scene.characterConsistencyInstructions).toContain(character!.name);
      expect(scene.imagePrompt.toLowerCase()).toContain(character!.name.toLowerCase().split(' ')[0]!);
    }
  });

  it('analyzes visuals in mock mode with canonical character descriptions and prompts', async () => {
    const provider = createProvider({ GEMINI_USE_MOCK: 'true' });
    const story = await provider.generateStoryContent(brief);
    const plan = await provider.planScenes({ brief, story: story.data });

    const result = await provider.analyzeVisuals({
      title: story.data.title,
      story: story.data.story,
      scenes: plan.data.scenes,
      characters: story.data.characters,
      style: {
        name: 'Cinematic photorealism',
        configuration: {
          lighting: 'Motivated cinematic lighting',
          colorTreatment: 'Natural skin tones',
          camera: 'Full-frame cinema',
          composition: 'Rule-of-thirds',
          imageGenerationInstructions: 'Photorealistic live-action still.',
          avoid: ['cartoon', 'anime'],
        },
      },
      aspectRatio: '9:16',
    });

    expect(result.usage.model).toBe('mock-gemini');
    expect(result.data.scenes.length).toBe(plan.data.scenes.length);
    expect(result.data.characters.length).toBe(story.data.characters.length);
    expect(result.data.scenes[0]?.imagePrompt).toBeTruthy();
    expect(result.data.scenes[0]?.negativePrompt).toContain('cartoon');
  });
});
