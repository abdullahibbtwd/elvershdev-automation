import type { MotionAnalysisBatch, MotionBrief } from './schemas';
import type { MotionAnalysisInput } from './prompts';

/** Valid 1s 720x1280 H.264 MP4 generated with ffmpeg for mock Kling downloads / ffprobe. */
const EMBEDDED_MOCK_MP4_BASE64 = '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';

export function createMockMotionBrief(
  scene: MotionAnalysisInput['scenes'][number],
  characters: MotionAnalysisInput['characters'],
): MotionBrief & { sceneNumber: number } {
  const subject =
    scene.visualDescription.slice(0, 140) || `Scene ${scene.sceneNumber} subject`;
  const characterNames = characters.map((c) => c.name).join(', ') || 'the subject';
  const camera = scene.cameraMovement || 'slow cinematic push-in';
  const motionPrompt = [
    `Photorealistic continuation of the first frame. ${subject}.`,
    `${characterNames} move naturally with restrained body language.`,
    `Gentle facial expression shifts matching the narration mood.`,
    `Subtle environmental motion in ${scene.environment}.`,
    `Camera: ${camera}, preserving framing and lighting (${scene.lighting}).`,
    'Maintain identity, clothing, and composition from the source image. Natural, cinematic, restrained motion.',
  ]
    .join(' ')
    .slice(0, 2500);

  return {
    sceneNumber: scene.sceneNumber,
    mainSubject: subject,
    characterMovement: `Natural, restrained movement for ${characterNames}`,
    facialExpressions: 'Subtle, emotionally consistent expressions',
    bodyMovement: 'Gentle, story-appropriate body motion without exaggeration',
    environmentalMovement: `Soft ambient motion in ${scene.environment}`,
    cameraMovement: camera,
    cameraAngle: 'eye-level continuity with the source frame',
    cameraDistance: 'consistent with the source composition',
    sceneAtmosphere: scene.visualDescription.slice(0, 120) || 'cinematic atmosphere',
    lightingContinuity: scene.lighting || 'preserve source lighting',
    movementSpeed: 'slow',
    emotionalIntention: 'match the scene narration emotion',
    startFrameConsistency:
      scene.characterConsistencyInstructions ||
      'Preserve face, clothing, pose base, and location from the first frame',
    endFrameComposition: 'Hold a natural end pose without cutting or morphing',
    motionPrompt,
    negativePrompt:
      'morphing face, identity change, extra limbs, cartoon, anime, text overlay, watermark, jitter, teleporting',
  };
}

export function createMockMotionAnalysis(input: MotionAnalysisInput): MotionAnalysisBatch {
  return {
    scenes: input.scenes.map((scene) => createMockMotionBrief(scene, input.characters)),
  };
}

function decodeBase64(base64: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeBuffer = (globalThis as any).Buffer;
  if (nodeBuffer && typeof nodeBuffer.from === 'function') {
    return nodeBuffer.from(base64, 'base64') as Uint8Array;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atobFn = (globalThis as any).atob as ((s: string) => string) | undefined;
  if (!atobFn) {
    throw new Error('Unable to decode mock MP4 base64');
  }
  const binary = atobFn(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Returns a small valid H.264 MP4 buffer suitable for FFprobe validation. */
export function createMockMp4Buffer(_options?: {
  durationSeconds?: number;
  width?: number;
  height?: number;
}): Uint8Array {
  return decodeBase64(EMBEDDED_MOCK_MP4_BASE64);
}
