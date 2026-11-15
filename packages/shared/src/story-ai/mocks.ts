import type { GeneratedScenePlan, GeneratedStory, StoryBriefInput } from './schemas';

export function createMockStoryResult(brief: StoryBriefInput): GeneratedStory {
  return {
    title: `${brief.topic.slice(0, 40)} — ${brief.niche}`,
    story: `In the world of ${brief.niche}, a journey about ${brief.topic} unfolds for ${brief.targetAudience}.`,
    openingHook: `What if ${brief.topic} could change everything?`,
    narrationScript: `Welcome. Today we explore ${brief.topic}. Stay with me as we uncover what ${brief.targetAudience} need to know.`,
    closingMessage: `Remember this lesson about ${brief.topic}, and take one action today.`,
    description: `A ${brief.tone.toLowerCase()} ${brief.category.toLowerCase()} story about ${brief.topic}.`,
    hashtags: [brief.niche.replace(/\s+/g, ''), brief.category.replace(/\s+/g, ''), 'AIStory'],
    characters: [
      {
        name: 'Alex Rivera',
        appearance: 'Athletic build, warm olive skin, determined expression',
        clothing: 'Charcoal jacket over a simple white tee',
        ageRange: '28-35',
        hair: 'Short dark wavy hair',
        distinctiveFeatures: 'Small scar above left eyebrow, confident posture',
        consistencyNotes:
          'Always wears the charcoal jacket; keep facial features identical across scenes',
      },
    ],
  };
}

export function createMockScenePlan(
  brief: StoryBriefInput,
  story: GeneratedStory,
): GeneratedScenePlan {
  const sceneCount = Math.max(3, Math.min(8, Math.round(brief.desiredDurationSeconds / 10)));
  const duration = Number((brief.desiredDurationSeconds / sceneCount).toFixed(2));
  const character = story.characters[0];

  return {
    totalDurationSeconds: brief.desiredDurationSeconds,
    characters: story.characters,
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      sceneNumber: index + 1,
      durationSeconds: duration,
      narration: `${story.narrationScript.split('.')[0]}. Scene ${index + 1}.`,
      visualDescription: `Cinematic frame for scene ${index + 1} about ${brief.topic}`,
      imagePrompt: `Photorealistic still of ${character?.name ?? 'the protagonist'} in scene ${index + 1}, ${character?.appearance ?? 'consistent character'}, ${character?.clothing ?? 'consistent wardrobe'}`,
      videoPrompt: `Slow cinematic motion of scene ${index + 1}, maintain ${character?.consistencyNotes ?? 'character consistency'}`,
      cameraMovement: index % 2 === 0 ? 'slow push-in' : 'gentle lateral slide',
      lighting: index === 0 ? 'golden hour soft light' : 'controlled soft key light',
      environment: `${brief.niche} inspired environment, scene ${index + 1}`,
      characterConsistencyInstructions: character
        ? `Keep ${character.name} identical: ${character.appearance}; ${character.clothing}; ${character.hair}; ${character.distinctiveFeatures}`
        : 'No recurring character required',
    })),
  };
}
