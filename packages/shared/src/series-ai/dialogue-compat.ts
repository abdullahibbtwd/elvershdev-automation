import type { EpisodeScriptPlan } from './episode-schemas';
import type { DialogueEpisodeScriptPlan } from './dialogue-schemas';

/** Adapt dialogue-first plan into legacy EpisodeScriptPlan for continuity / adapter reuse. */
export function dialoguePlanToEpisodeScriptPlan(
  plan: DialogueEpisodeScriptPlan,
): EpisodeScriptPlan {
  return {
    episodeNumber: plan.episodeNumber,
    title: plan.title,
    synopsis: plan.synopsis,
    hook: plan.hook,
    narrationText: plan.narrationText?.trim() || plan.script,
    script: plan.script,
    ending: plan.ending,
    cliffhanger: plan.cliffhanger,
    nextEpisodeSetup: plan.nextEpisodeSetup,
    keyPlotDevelopment: plan.keyPlotDevelopment,
    emotionalBeats: plan.emotionalBeats,
    spokenWordCount: plan.spokenWordCount,
    scenes: plan.scenes.map((scene) => ({
      sceneOrder: scene.sceneNumber,
      location: scene.location,
      characters: scene.characters,
      action: scene.action,
      visualDescription: scene.visualDescription,
      dialogue: scene.shots
        .filter((shot) => shot.dialogue.trim())
        .map((shot) => `${shot.speaker}: ${shot.dialogue}`)
        .join('\n'),
      narration: scene.narration,
      emotionalDirection: scene.emotionalDirection,
      shotDirection: scene.shots.map((shot) => shot.cameraDirection).join('; '),
    })),
    continuityChanges: plan.continuityChanges,
    memoryEvents: plan.memoryEvents,
  };
}
