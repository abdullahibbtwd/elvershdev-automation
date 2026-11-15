import type {
  CharacterCanonicalVisual,
  SceneVisualAnalysis,
  VisualAnalysisBatch,
  VisualStyleConfiguration,
} from './schemas';
import { buildCanonicalCharacterDescription } from './prompts';

export function createMockVisualAnalysis(input: {
  scenes: Array<{
    sceneNumber: number;
    visualDescription: string;
    imagePrompt: string;
    lighting: string;
    environment: string;
    cameraMovement: string;
    characterConsistencyInstructions: string;
  }>;
  characters: Array<{
    name: string;
    appearance: string;
    clothing: string;
    ageRange: string;
    hair: string;
    distinctiveFeatures: string;
    consistencyNotes: string;
  }>;
  style: { name: string; configuration: VisualStyleConfiguration };
  aspectRatio?: string;
}): VisualAnalysisBatch {
  const aspectRatio = input.aspectRatio ?? '9:16';
  const characters: CharacterCanonicalVisual[] = input.characters.map((c) => {
    const canonicalVisualDescription = buildCanonicalCharacterDescription(c);
    return {
      name: c.name,
      description: c.appearance,
      approximateAge: c.ageRange,
      facialFeatures: c.appearance,
      hairstyle: c.hair,
      hairColor: c.hair,
      clothing: c.clothing,
      distinguishingCharacteristics: c.distinctiveFeatures,
      visualConsistencyInstructions: c.consistencyNotes,
      canonicalVisualDescription,
    };
  });

  const scenes = input.scenes.map((scene) => {
    const present = input.characters.map((c) => c.name);
    const analysis: SceneVisualAnalysis & { sceneNumber: number } = {
      sceneNumber: scene.sceneNumber,
      mainSubject: scene.visualDescription.slice(0, 120) || `Scene ${scene.sceneNumber} subject`,
      charactersPresent: present,
      characterAppearances: input.characters.map((c) => ({
        name: c.name,
        appearance: c.appearance,
        clothing: c.clothing,
        ageRange: c.ageRange,
        facialExpression: 'expressive and story-appropriate',
        bodyPosture: 'natural storytelling posture',
        physicalAction: 'engaged in the scene action',
      })),
      location: scene.environment,
      environment: scene.environment,
      timeOfDay: 'golden hour',
      weather: 'clear',
      lighting: scene.lighting || input.style.configuration.lighting,
      cameraAngle: scene.cameraMovement || 'eye-level',
      cameraDistance: 'medium shot',
      composition: input.style.configuration.composition,
      backgroundDetails: scene.environment,
      emotionalAtmosphere: 'cinematic and emotionally clear',
      visualStyleNotes: input.style.configuration.imageGenerationInstructions,
      aspectRatio,
      imagePrompt: [
        scene.imagePrompt || scene.visualDescription,
        ...characters.map((c) => c.canonicalVisualDescription),
        input.style.configuration.imageGenerationInstructions,
        `${aspectRatio} vertical frame`,
      ].join('. '),
      negativePrompt: input.style.configuration.avoid.join(', '),
    };
    return analysis;
  });

  return { characters, scenes };
}

/** Minimal 1x1 PNG used as a mock generated image buffer. */
export function createMockPngBuffer(): Uint8Array {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W5W0AAAAASUVORK5CYII=';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeBuffer = (globalThis as any).Buffer;
  if (nodeBuffer && typeof nodeBuffer.from === 'function') {
    return nodeBuffer.from(base64, 'base64') as Uint8Array;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atobFn = (globalThis as any).atob as ((s: string) => string) | undefined;
  if (atobFn) {
    const binary = atobFn(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
    0x03, 0x03, 0x02, 0x00, 0xee, 0x56, 0xe5, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}
