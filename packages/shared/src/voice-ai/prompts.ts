export interface NarrationPlanningSceneInput {
  sceneId: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visualDescription?: string;
}

export interface NarrationPlanningInput {
  title: string;
  story: string;
  openingHook?: string | null;
  narrationScript?: string | null;
  closingMessage?: string | null;
  language: string;
  tone?: string | null;
  targetDurationSeconds?: number | null;
  characters: Array<{ name: string }>;
  scenes: NarrationPlanningSceneInput[];
}

export function buildNarrationPlanningPrompt(input: NarrationPlanningInput): string {
  const characterNames = input.characters.map((c) => c.name).join(', ') || 'none listed';
  const scenesBlock = input.scenes
    .map(
      (scene) =>
        `Scene ${scene.sceneNumber} (id=${scene.sceneId}, targetSeconds=${scene.durationSeconds}):\n` +
        `Approved narration source:\n${scene.narration}\n`,
    )
    .join('\n');

  return `You are a professional narration scriptwriter for short-form video.
Transform the approved story and per-scene narration into spoken narration scripts.

Hard rules:
- Preserve meaning and chronology. Do NOT invent events that are not in the approved story/scenes.
- Prefer approved scene narration text over visual descriptions or image prompts.
- Write natural spoken language (not screenplay stage directions).
- Avoid repetitive phrasing across scenes.
- Keep each scene concise enough for its target duration.
- Keep character and place names consistent: ${characterNames}.
- Include pronunciationGuidance only for difficult names.
- estimatedDurationSeconds must be realistic for spoken delivery.
- sequence must match scene order starting at 1.
- speakingStyle should be a short delivery cue suitable for TTS speech_metadata.style
  (e.g. "warm and measured", "urgent whisper").
- emotionalTone should be a short emotion label (e.g. "hopeful", "tense").

Story context:
- Title: ${input.title}
- Language: ${input.language}
- Tone: ${input.tone ?? 'cinematic'}
- Target total duration (seconds): ${input.targetDurationSeconds ?? 'unspecified'}
- Opening hook: ${input.openingHook ?? ''}
- Existing full narration script (optional reference): ${input.narrationScript ?? ''}
- Closing message: ${input.closingMessage ?? ''}
- Full story:
${input.story}

Scenes:
${scenesBlock}

emotionalTone, speakingStyle, deliveryInstructions, and pronunciationGuidance must be flat strings (never objects).
Return ONLY valid JSON matching this shape:
{
  "fullText": "concatenated narration for the whole story",
  "notes": "optional short notes",
  "scenes": [
    {
      "sceneId": "uuid from input",
      "sceneNumber": 1,
      "sequence": 1,
      "text": "spoken narration for this scene",
      "emotionalTone": "warm",
      "speakingStyle": "calm and measured",
      "deliveryInstructions": "optional short delivery notes",
      "pronunciationGuidance": "optional",
      "estimatedDurationSeconds": 8.5
    }
  ]
}`;
}

export function buildSpeechStyleInstruction(options: {
  speakingStyle?: string | null;
  emotionalTone?: string | null;
  deliveryInstructions?: string | null;
}): string {
  const parts = [
    options.speakingStyle?.trim(),
    options.emotionalTone ? `${options.emotionalTone} tone` : undefined,
    options.deliveryInstructions?.trim(),
  ].filter(Boolean);
  return parts.join(', ').slice(0, 200);
}
