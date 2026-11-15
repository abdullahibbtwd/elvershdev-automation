import type { MotionBrief } from './schemas';

export interface MotionAnalysisSceneInput {
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  videoPrompt: string;
  cameraMovement: string;
  lighting: string;
  environment: string;
  characterConsistencyInstructions: string;
  selectedVisualPrompt?: string | null;
  structuredBrief?: Record<string, unknown> | null;
}

export interface MotionAnalysisCharacterInput {
  name: string;
  appearance: string;
  clothing: string;
  ageRange: string;
  hair: string;
  distinctiveFeatures: string;
  consistencyNotes: string;
  canonicalVisualDescription?: string | null;
}

export interface MotionAnalysisInput {
  title: string;
  story: string;
  scenes: MotionAnalysisSceneInput[];
  characters: MotionAnalysisCharacterInput[];
  styleName?: string | null;
  styleNotes?: string | null;
  defaultDurationSeconds: number;
}

export function buildMotionAnalysisPrompt(input: MotionAnalysisInput): string {
  return `You are a cinematic motion director for photorealistic image-to-video generation.

Convert each story scene into a restrained, natural motion brief for Kling image-to-video.
The first frame is an already-generated still image. Preserve appearance, clothing, location, lighting, composition, and the original action.
Do NOT invent new characters, props, locations, or plot events.
Prefer subtle, believable motion over exaggerated animation.

Story title: ${input.title}
Story:
${input.story}

Visual style: ${input.styleName ?? 'photoreal cinematic'}
Style notes: ${input.styleNotes ?? 'natural lighting continuity'}
Default clip duration seconds: ${input.defaultDurationSeconds}

Characters:
${JSON.stringify(input.characters, null, 2)}

Scenes:
${JSON.stringify(input.scenes, null, 2)}

Return ONLY valid JSON matching this shape:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "mainSubject": "...",
      "characterMovement": "...",
      "facialExpressions": "...",
      "bodyMovement": "...",
      "environmentalMovement": "...",
      "cameraMovement": "...",
      "cameraAngle": "...",
      "cameraDistance": "...",
      "sceneAtmosphere": "...",
      "lightingContinuity": "...",
      "movementSpeed": "slow|gentle|natural",
      "emotionalIntention": "...",
      "startFrameConsistency": "...",
      "endFrameComposition": "...",
      "motionPrompt": "single provider-ready motion prompt under 2500 chars",
      "negativePrompt": "things to avoid"
    }
  ]
}

Motion prompt guidance:
- Describe camera and subject motion relative to the existing first frame.
- Keep identity and wardrobe stable.
- Examples of good motion: slow cinematic push-in, gentle head turn, natural walking, subtle hand gestures, wind in clothing/trees, slow pan, restrained tracking.
- Avoid: morphing faces, extra limbs, sudden teleporting, cartoon physics, text overlays, logo watermarks.`;
}

export function composeMotionPromptFromBrief(brief: MotionBrief): string {
  return [
    brief.motionPrompt,
    `Camera: ${brief.cameraMovement}; ${brief.cameraAngle}; ${brief.cameraDistance}.`,
    `Subject motion: ${brief.characterMovement}; ${brief.bodyMovement}; ${brief.facialExpressions}.`,
    `Environment: ${brief.environmentalMovement}.`,
    `Atmosphere: ${brief.sceneAtmosphere}. Lighting continuity: ${brief.lightingContinuity}.`,
    `Speed: ${brief.movementSpeed}. Emotion: ${brief.emotionalIntention}.`,
    `Keep start-frame identity: ${brief.startFrameConsistency}.`,
    `End frame: ${brief.endFrameComposition}.`,
  ]
    .join(' ')
    .slice(0, 2500);
}
