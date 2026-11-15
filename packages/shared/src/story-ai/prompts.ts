import type { GeneratedStory, StoryBriefInput } from './schemas';

export function buildStoryGenerationPrompt(brief: StoryBriefInput): string {
  return [
    'You are an expert short-form video storyteller.',
    'Generate an original story package as strict JSON matching the required schema.',
    'Do not include markdown fences or commentary.',
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
    'Requirements:',
    '- Compelling title',
    '- Original full story narrative',
    '- Strong opening hook',
    '- Narration script suitable for voiceover',
    '- Closing message',
    '- Short description for social posts',
    '- Relevant hashtags without # symbol duplication issues (plain tags ok)',
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
    'You are a film director planning AI-generated video scenes.',
    'Return strict JSON matching the required schema. No markdown.',
    '',
    `Target total duration seconds: ${input.brief.desiredDurationSeconds}`,
    `Language: ${input.brief.language}`,
    `Tone: ${input.brief.tone}`,
    `Niche: ${input.brief.niche}`,
    '',
    `Title: ${input.story.title}`,
    `Story: ${input.story.story}`,
    `Narration script: ${input.story.narrationScript}`,
    '',
    'Character consistency bible (must not contradict across scenes):',
    characterBlock,
    '',
    'Requirements:',
    '- Break the narration into ordered scenes',
    '- Sum of scene durations MUST approximately equal the target duration (within ~10%)',
    '- Each scene needs narration, visual description, image prompt, video prompt, camera, lighting, environment, and character consistency instructions',
    '- Reuse the same character appearance details whenever a character appears',
  ].join('\n');
}
