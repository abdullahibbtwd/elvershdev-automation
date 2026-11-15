import type { GeneratedStory, StoryBriefInput } from './schemas';

export function buildStoryGenerationPrompt(brief: StoryBriefInput): string {
  return [
    'You are an expert short-form video storyteller for an international English-speaking audience.',
    'Create ORIGINAL cinematic micro-stories — NOT generic motivational quote cards.',
    'Return ONE JSON object with EXACTLY these top-level string keys:',
    'title, story, openingHook, narrationScript, closingMessage, description,',
    'plus hashtags (string array) and characters (array).',
    'Do not nest story fields. Do not wrap the object. Do not use markdown fences.',
    'character.appearance must be a single flat string (never an object).',
    '',
    `Topic: ${brief.topic}`,
    `Niche: ${brief.niche}`,
    `Target audience: ${brief.targetAudience}`,
    `Language: ${brief.language}`,
    `Tone: ${brief.tone}`,
    `Desired duration (seconds): ${brief.desiredDurationSeconds}`,
    `Category: ${brief.category}`,
    brief.additionalInstructions
      ? `Additional instructions: ${brief.additionalInstructions}`
      : '',
    '',
    'Required character fields when characters are present:',
    'name, appearance, clothing, ageRange, hair, distinctiveFeatures, consistencyNotes',
    '',
    'Story craft requirements:',
    '- openingHook: powerful curiosity spike for the FIRST 2–3 seconds of voiceover',
    '- story + narrationScript: keep viewers curious, then deliver an emotional or surprising turning point',
    '- closingMessage: meaningful lesson that is NOT always "never give up" — vary endings (hope, kindness, perspective, courage, patience)',
    '- narrationScript must be speakable aloud in about the desired duration (natural emotional English)',
    '- description: platform-ready caption hook (1–2 sentences) without stuffing hashtags into it',
    '- hashtags: 10–15 tags WITHOUT # prefix; mix niche + emotion + discovery (storytime, motivation, lifelessons, fyp, reels, shorts, etc.)',
    '- Include a soft follow CTA near the end of narration (natural, not spammy)',
    '- Prefer concrete characters and scenes over abstract advice',
    '- If recurring characters exist, include character profiles with stable appearance details',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildScenePlanningPrompt(input: {
  brief: StoryBriefInput;
  story: GeneratedStory;
}): string {
  const characterBlock =
    input.story.characters.length > 0
      ? input.story.characters
          .map(
            (c) =>
              `- ${c.name}: appearance=${c.appearance}; clothing=${c.clothing}; age=${c.ageRange}; hair=${c.hair}; features=${c.distinctiveFeatures}; notes=${c.consistencyNotes}`,
          )
          .join('\n')
      : '- None specified; invent only if essential and keep them consistent.';

  return [
    'You are a film director planning AI-generated vertical (9:16) cinematic scenes.',
    'Return ONE JSON object with keys: totalDurationSeconds (number), scenes (array), characters (array).',
    'Each scene MUST use EXACT flat string fields:',
    'sceneNumber, durationSeconds, narration, visualDescription, imagePrompt, videoPrompt,',
    'cameraMovement, lighting, environment, characterConsistencyInstructions.',
    'lighting and environment must be strings, never objects. No markdown fences.',
    '',
    `Target total duration seconds: ${input.brief.desiredDurationSeconds}`,
    `Language: ${input.brief.language}`,
    `Tone: ${input.brief.tone}`,
    `Niche: ${input.brief.niche}`,
    '',
    `Title: ${input.story.title}`,
    `Opening hook: ${input.story.openingHook}`,
    `Story: ${input.story.story}`,
    `Narration script: ${input.story.narrationScript}`,
    '',
    'Character consistency bible (must not contradict across scenes):',
    characterBlock,
    '',
    'Requirements:',
    '- Plan 6–9 scenes when duration is 40–60s (fewer only if the story is shorter)',
    '- Scene 1 must visualize the hook in the first 2–3 seconds',
    '- Mid scenes should raise curiosity; include a clear turning-point scene',
    '- Final scene should land the lesson / emotional payoff',
    '- Visual style: cinematic photorealism, emotional lighting, vertical composition',
    '- Break the narration into ordered scenes',
    '- Sum of scene durations MUST approximately equal the target duration (within ~10%)',
    '- Reuse the same character appearance details whenever a character appears',
    '- imagePrompt and videoPrompt must be concrete, filmable, and consistent with the narration',
  ].join('\n');
}
