import type { MovieArchitectBrief, MovieArcPlan, MoviePremise, SeriesCharacterPlan } from './schemas';

const CINEMATIC_RULES = [
  'Create ONE complete fictional cinematic drama movie told across interconnected episodes.',
  'Do NOT invent 10 unrelated short stories. Every episode must advance one continuous movie narrative.',
  'The complete ending/resolution MUST already exist in the master plan before Episode 1 is produced.',
  'Visual direction: mature, premium cinematic 3D animation — never children’s cartoon aesthetics.',
  'Characters may be human, anthropomorphic animals, or stylized cinematic 3D characters.',
  'Track secrets carefully: audience knowledge vs which characters know vs who is still unaware.',
  'Return ONE JSON object only. No markdown fences. No commentary outside JSON.',
].join('\n');

export function buildMoviePremisePrompt(brief: MovieArchitectBrief): string {
  const customMode = brief.ideaMode === 'custom' && brief.customPremise?.trim();
  return [
    'You are the Movie Architect for an episodic AI drama series.',
    CINEMATIC_RULES,
    customMode
      ? 'Expand the USER-PROVIDED movie idea into a complete premise. Do not ignore or replace the core idea.'
      : 'Generate an ORIGINAL movie premise using the creative settings below.',
    'System safety, continuity, and quality requirements always override user creative preferences.',
    'Generate the movie premise identity fields only.',
    '',
    `Genre: ${brief.genre}`,
    `Subgenres: ${brief.subgenres.join(', ') || 'none'}`,
    `Theme: ${brief.theme ?? 'original dramatic conflict'}`,
    `Target audience: ${brief.targetAudience}`,
    `Language: ${brief.language}`,
    `Tone: ${brief.tone}`,
    `Visual direction: ${brief.visualDirection}`,
    `Planned episode count: ${brief.plannedEpisodeCount}`,
    `Target episode duration seconds: ${brief.targetEpisodeDurationSeconds}`,
    customMode ? `USER MOVIE IDEA (expand faithfully):\n${brief.customPremise}` : '',
    brief.additionalInstructions ? `Additional creative preferences: ${brief.additionalInstructions}` : '',
    '',
    'Required keys: title, logline, synopsis, genre, subgenres, targetAudience, setting, worldRules, mainConflict, visualStyle.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildMovieCharactersPrompt(input: {
  brief: MovieArchitectBrief;
  premise: MoviePremise;
}): string {
  return [
    'You are the Character Director for a cinematic episodic drama.',
    CINEMATIC_RULES,
    'Create a complete main + supporting cast with canonical visual identities.',
    'Include at least one protagonist and meaningful supporting characters with secrets, flaws, and relationships.',
    'Never describe characters only by generic species/name — be specific and cinematic.',
    '',
    `Title: ${input.premise.title}`,
    `Logline: ${input.premise.logline}`,
    `Setting: ${input.premise.setting}`,
    `Main conflict: ${input.premise.mainConflict}`,
    `World rules: ${input.premise.worldRules}`,
    `Visual style: ${input.premise.visualStyle}`,
    `Tone: ${input.brief.tone}`,
    '',
    'Return { "characters": [ ... ] } with every required character field populated as flat strings.',
  ].join('\n');
}

export function buildMovieArcPrompt(input: {
  brief: MovieArchitectBrief;
  premise: MoviePremise;
  characters: SeriesCharacterPlan[];
}): string {
  const cast = input.characters
    .map((c) => `- ${c.name} (${c.role}, ${c.species}): ${c.motivation}; secrets=${c.secrets.join('; ')}`)
    .join('\n');

  return [
    'You are the Movie Architect writing the complete story bible arc.',
    CINEMATIC_RULES,
    'The ending must be fully specified now. Include secrets/reveals/foreshadowing and a knowledge map.',
    '',
    `Title: ${input.premise.title}`,
    `Synopsis: ${input.premise.synopsis}`,
    `Setting: ${input.premise.setting}`,
    `Main conflict: ${input.premise.mainConflict}`,
    `Episodes planned: ${input.brief.plannedEpisodeCount}`,
    '',
    'Cast:',
    cast,
    '',
    'Required keys: premise, masterPlot, beginning, middle, climax, resolution, ending, majorConflicts,',
    'secrets, reveals, foreshadowingMap, characterArcs, knowledgeMap.',
  ].join('\n');
}

export function buildEpisodeOutlinesPrompt(input: {
  brief: MovieArchitectBrief;
  premise: MoviePremise;
  arc: MovieArcPlan;
  characters: SeriesCharacterPlan[];
  fromEpisode: number;
  toEpisode: number;
  previousOutlinesSummary?: string;
}): string {
  const names = input.characters.map((c) => c.name).join(', ');
  return [
    'You are the Episode Director outlining interconnected episodes of ONE movie.',
    CINEMATIC_RULES,
    `Generate episode outlines ONLY for episodes ${input.fromEpisode} through ${input.toEpisode} inclusive.`,
    'Each episode must contribute to the master plot, with progression and character-driven conflict.',
    'Not every episode needs an extreme cliffhanger, but endings should be meaningful.',
    'The final episode in the full series must land the planned resolution/ending.',
    '',
    `Title: ${input.premise.title}`,
    `Master plot: ${input.arc.masterPlot}`,
    `Ending (must be respected): ${input.arc.ending}`,
    `Climax: ${input.arc.climax}`,
    `Characters: ${names}`,
    `Total planned episodes: ${input.brief.plannedEpisodeCount}`,
    input.previousOutlinesSummary
      ? `Previous episode outline summary:\n${input.previousOutlinesSummary}`
      : '',
    '',
    'Return { "episodes": [ ... ] } with required episode outline fields.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStoryQualityPrompt(input: {
  brief: MovieArchitectBrief;
  premise: MoviePremise;
  arc: MovieArcPlan;
  episodeCount: number;
  acceptanceThreshold: number;
}): string {
  return [
    'You are a Story Quality Evaluator for cinematic episodic dramas.',
    'Score craft quality only. Do NOT claim or imply viral performance prediction.',
    `Acceptance threshold overall score: ${input.acceptanceThreshold}`,
    'Set accepted=true only if overall >= threshold AND completeStoryResolution is strong AND plotCoherence is strong.',
    '',
    `Title: ${input.premise.title}`,
    `Logline: ${input.premise.logline}`,
    `Synopsis: ${input.premise.synopsis}`,
    `Beginning: ${input.arc.beginning}`,
    `Middle: ${input.arc.middle}`,
    `Climax: ${input.arc.climax}`,
    `Ending: ${input.arc.ending}`,
    `Episode count: ${input.episodeCount}`,
    `Tone: ${input.brief.tone}`,
    '',
    'Return scores 0..1 for: originality, characterDepth, emotionalEngagement, suspense, plotCoherence,',
    'episodeProgression, cliffhangerPayoffQuality, dialoguePotential, continuity, completeStoryResolution, overall,',
    'plus explanations (object of strings), accepted (boolean), rejectionReasons (array), note (string).',
  ].join('\n');
}

export function buildSeriesCharacterReferencePrompt(character: SeriesCharacterPlan): string {
  return [
    'Premium cinematic 3D character portrait, mature dramatic lighting, highly detailed face,',
    'consistent identity sheet style, single character, centered, neutral background,',
    `name implied identity: ${character.name}, species/type: ${character.species}, age: ${character.ageRange},`,
    character.canonicalVisualDescription,
    `facial structure: ${character.facialStructure}, eyes: ${character.eyeColor} ${character.eyeShape},`,
    `hair/fur: ${character.hairFurColor}, markings: ${character.markings},`,
    `clothing: ${character.clothing}, accessories: ${character.accessories},`,
    'not a children’s cartoon, no text, no watermark, no collage',
  ].join(' ');
}
