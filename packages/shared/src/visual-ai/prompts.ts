import type { VisualStyleConfiguration } from './schemas';

export interface VisualAnalysisSceneInput {
  sceneNumber: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  cameraMovement: string;
  lighting: string;
  environment: string;
  characterConsistencyInstructions: string;
}

export interface VisualAnalysisCharacterInput {
  name: string;
  appearance: string;
  clothing: string;
  ageRange: string;
  hair: string;
  distinctiveFeatures: string;
  consistencyNotes: string;
}

export function buildVisualAnalysisPrompt(input: {
  title: string;
  story: string;
  scenes: VisualAnalysisSceneInput[];
  characters: VisualAnalysisCharacterInput[];
  style: { name: string; configuration: VisualStyleConfiguration };
  aspectRatio: string;
}): string {
  const characterBible =
    input.characters.length === 0
      ? 'No named characters.'
      : input.characters
          .map(
            (c) =>
              `- ${c.name}: appearance=${c.appearance}; clothing=${c.clothing}; age=${c.ageRange}; hair=${c.hair}; distinctive=${c.distinctiveFeatures}; notes=${c.consistencyNotes}`,
          )
          .join('\n');

  const scenesBlock = input.scenes
    .map(
      (s) => `Scene ${s.sceneNumber}
Narration: ${s.narration}
Visual description: ${s.visualDescription}
Existing image prompt: ${s.imagePrompt}
Camera: ${s.cameraMovement}
Lighting: ${s.lighting}
Environment: ${s.environment}
Consistency: ${s.characterConsistencyInstructions}`,
    )
    .join('\n\n');

  return `You are a visual intelligence engine for a photorealistic storytelling video platform.

Convert each story scene into structured visual-generation instructions.

Story title: ${input.title}
Story:
${input.story}

Character bible (must remain consistent):
${characterBible}

Visual style: ${input.style.name}
Lighting: ${input.style.configuration.lighting}
Color: ${input.style.configuration.colorTreatment}
Camera: ${input.style.configuration.camera}
Composition: ${input.style.configuration.composition}
Generation instructions: ${input.style.configuration.imageGenerationInstructions}
Avoid: ${input.style.configuration.avoid.join(', ')}
Target aspect ratio: ${input.aspectRatio}

Scenes:
${scenesBlock}

Rules:
1. Faithfully represent each existing scene. Do not invent unrelated characters, locations, events, or objects.
2. Produce a canonical visual description for every character in the bible.
3. For each scene, include every listed structured field and a detailed imagePrompt plus negativePrompt.
4. Prefer photorealistic cinematic language. Avoid cartoon/illustrated looks unless the style explicitly asks for it.
5. imagePrompt must incorporate canonical character descriptions for characters present in that scene.
6. Return JSON only matching:
{
  "characters": [{
    "name": string,
    "description": string,
    "approximateAge": string,
    "genderPresentation": string optional,
    "skinTone": string optional,
    "facialFeatures": string,
    "hairstyle": string,
    "hairColor": string,
    "bodyBuild": string optional,
    "clothing": string,
    "accessories": string optional,
    "distinguishingCharacteristics": string,
    "visualConsistencyInstructions": string,
    "canonicalVisualDescription": string
  }],
  "scenes": [{
    "sceneNumber": number,
    "mainSubject": string,
    "charactersPresent": string[],
    "characterAppearances": [{
      "name": string,
      "appearance": string,
      "clothing": string,
      "ageRange": string optional,
      "facialExpression": string,
      "bodyPosture": string,
      "physicalAction": string
    }],
    "location": string,
    "environment": string,
    "timeOfDay": string,
    "weather": string,
    "lighting": string,
    "cameraAngle": string,
    "cameraDistance": string,
    "composition": string,
    "backgroundDetails": string,
    "emotionalAtmosphere": string,
    "visualStyleNotes": string,
    "aspectRatio": string,
    "imagePrompt": string,
    "negativePrompt": string
  }]
}`;
}

export function buildCharacterReferencePrompt(input: {
  name: string;
  canonicalVisualDescription: string;
  styleName: string;
  styleInstructions: string;
}): string {
  return [
    `Photorealistic character reference portrait of ${input.name}.`,
    input.canonicalVisualDescription,
    `Style: ${input.styleName}. ${input.styleInstructions}`,
    'Neutral three-quarter portrait, clear face, consistent identity reference, soft cinematic lighting, sharp facial detail.',
    'No text overlays, no collage, no multiple people.',
  ].join(' ');
}

export function buildSceneImagePrompt(input: {
  visualPrompt: string;
  characterDescriptions: string[];
  styleInstructions: string;
  negativePrompt?: string | null;
}): { prompt: string; negativePrompt: string } {
  const characterBlock =
    input.characterDescriptions.length > 0
      ? `Character consistency: ${input.characterDescriptions.join(' | ')}`
      : '';
  const prompt = [input.visualPrompt, characterBlock, input.styleInstructions]
    .filter(Boolean)
    .join('\n');
  const negativePrompt =
    input.negativePrompt?.trim() ||
    'cartoon, illustration, anime, drawing, cgi, 3d render, deformed face, extra limbs, watermark, text overlay';
  return { prompt, negativePrompt };
}

export function buildCanonicalCharacterDescription(input: {
  name: string;
  appearance: string;
  clothing: string;
  ageRange: string;
  hair: string;
  distinctiveFeatures: string;
  consistencyNotes?: string | null;
  genderPresentation?: string | null;
  skinTone?: string | null;
  facialFeatures?: string | null;
  hairstyle?: string | null;
  hairColor?: string | null;
  bodyBuild?: string | null;
  accessories?: string | null;
}): string {
  const parts = [
    input.name,
    `age ${input.ageRange}`,
    input.genderPresentation || undefined,
    input.skinTone || undefined,
    input.facialFeatures || input.appearance,
    `hair: ${input.hairstyle || input.hair}${input.hairColor ? `, ${input.hairColor}` : ''}`,
    input.bodyBuild || undefined,
    `wearing ${input.clothing}`,
    input.accessories ? `accessories: ${input.accessories}` : undefined,
    `distinguishing: ${input.distinctiveFeatures}`,
    input.consistencyNotes || undefined,
  ].filter(Boolean);
  return parts.join('; ');
}
