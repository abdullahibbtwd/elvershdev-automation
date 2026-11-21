import type { MovieArchitectBrief, MovieArcPlan, MoviePremise, SeriesCharacterPlan } from './schemas';

const CINEMATIC_RULES = [
  'Create ONE complete fictional cinematic movie told across interconnected episodes.',
  'Do NOT invent unrelated short stories. Every episode must advance one continuous movie narrative.',
  'The complete ending/resolution MUST already exist in the master plan before Episode 1 is produced.',
  'Characters may be human, anthropomorphic animals, or stylized cinematic characters as the selected visual style allows.',
  'Track secrets carefully: audience knowledge vs which characters know vs who is still unaware.',
  'Return ONE JSON object only. No markdown fences. No commentary outside JSON.',
].join('\n');

const STORYTELLING_INTELLIGENCE = [
  'STORYTELLING INTELLIGENCE (mandatory) — quality bar for social-video movies:',
  '- A stranger must understand the story after one read: who wants what, what goes wrong, how it ends.',
  '- Prefer SIMPLE, CLEAR plots over complicated lore. Small cast (usually 2–4 speaking characters). One main location or a few related spaces.',
  '- Structure: setup → misunderstanding/conflict → emotional escalation → reveal or decision → satisfying ending.',
  '- Include a meaningful twist or reveal when the genres/themes support it (e.g. jealousy → assumption → truth). The twist must be earned by earlier details — never random shock.',
  '- Do NOT build a plot by merely listing genres/themes. Use them as creative direction for an original human conflict.',
  '- Do NOT force stock templates (inheritance deeds, bakery fights, medical-secret showdowns, etc.) unless settings require them.',
  '- Genre fidelity examples: Romantic drama + Jealousy → intimacy, trust, suspicion, confrontation, emotional payoff. Mystery → clues and discoveries. Family drama → relationship consequences.',
  '- Write for spoken video: plain modern English, short natural lines people would actually say. No purple prose, no literary essay narration, no narrator explaining the plot.',
  '- Design for Grok clip generation: clear actions, readable facial emotions, simple blocking, and episode beats that can be filmed as ≤15s packs.',
  '- Story objects matter on camera: if the plot depends on a phone, ring, letter, keys, gift, photo, or similar prop, the outline must treat that object as a visible story beat — not only dialogue about it.',
  '- Scale cleanly with duration: a 60s movie may be 2×30s parts; a 10-minute movie uses more episodes of the same clarity — never pad with confusion.',
  '- Avoid filler, unnecessary characters, and scenes that exist only to fill time.',
].join('\n');

function formatCreativeBriefBlock(brief: MovieArchitectBrief): string[] {
  return [
    'SELECTED CREATIVE SETTINGS (must shape the story — not decorative metadata):',
    `Genre: ${brief.genre}`,
    `Subgenres: ${brief.subgenres.join(', ') || 'none'}`,
    `Theme: ${brief.theme ?? 'original dramatic conflict'}`,
    `Target audience: ${brief.targetAudience}`,
    `Language: ${brief.language}`,
    `Tone: ${brief.tone}`,
    `Visual direction (authoritative for character and world description): ${brief.visualDirection}`,
    `Production format: ${brief.productionFormat ?? 'episodic'}`,
    `Complete story/movie duration seconds: ${brief.targetStoryDurationSeconds ?? brief.plannedEpisodeCount * brief.targetEpisodeDurationSeconds}`,
    `Individual episode duration seconds: ${brief.targetEpisodeDurationSeconds}`,
    `Planned episode count: ${brief.plannedEpisodeCount}`,
    `Max video clip duration seconds: ${brief.maxClipDurationSeconds ?? 15} (never confuse with episode or movie duration)`,
    brief.additionalInstructions
      ? `Additional creative instructions / lane preferences:\n${brief.additionalInstructions}`
      : '',
  ].filter(Boolean);
}

export function buildMoviePremisePrompt(brief: MovieArchitectBrief): string {
  const customMode = brief.ideaMode === 'custom' && brief.customPremise?.trim();
  return [
    'You are the Movie Architect for an episodic AI cinematic series.',
    CINEMATIC_RULES,
    STORYTELLING_INTELLIGENCE,
    customMode
      ? 'CUSTOM MODE: Expand the USER-PROVIDED movie idea into a complete premise. Preserve the core conflict, characters, and emotional intent. Enrich with setting, stakes, and visual identity without replacing the idea.'
      : [
          'GENERATE MODE: invent a brand-new original movie premise guided by the selected creative settings below.',
          'Do not reuse a previous plot. Do not default to a stock family/breakfast/inheritance story unless genres/themes/custom instructions require it.',
          'ONE clear conflict a social-video viewer understands immediately (example pattern, NOT the required plot: a jealousy misunderstanding that flips into a loving reveal).',
          'Logline = curiosity + human stakes in one sentence. Synopsis = opening situation, escalating conflict, emotional turn, and complete ending trajectory in plain English.',
        ].join(' '),
    'System safety, continuity, and quality requirements always override user creative preferences.',
    'Generate the movie premise identity fields only.',
    '',
    ...formatCreativeBriefBlock(brief),
    customMode ? `USER MOVIE IDEA (expand faithfully):\n${brief.customPremise}` : '',
    'Writing style: clear everyday English. Prefer “Who is Maya?” over ornate wording. Avoid purple prose.',
    'visualStyle MUST follow the selected Visual direction above — do not invent a conflicting default look.',
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
    STORYTELLING_INTELLIGENCE,
    'Create a small, clear cast that feels like real people, not plot devices.',
    'CHARACTER DEVELOPMENT REQUIREMENTS:',
    '- Prefer 2–4 speaking characters total unless the story truly needs more.',
    '- At least one PROTAGONIST with clear wants, fears, and emotional stakes.',
    '- Supporting characters with distinct personalities, relationships, and reasons to be in the scene.',
    '- Give each character a simple CARTOON visual identity a video model can lock: age, look, hair, clothing colors (e.g. “25, African woman, shoulder-length black hair, red dress, stylized 3D cartoon”).',
    '- Describe characters for animated/cartoon continuity — not photoreal live-action humans.',
    '- Define secrets/misunderstandings that can create tension without needing a huge cast.',
    '- Relationships must create pressure, loyalty, conflict, or care.',
    '- The protagonist must change emotionally by the ending (relief, regret, love restored, truth accepted, etc.).',
    '- Canonical visual identities MUST follow the selected visual direction / premise visualStyle.',
    '',
    ...formatCreativeBriefBlock(input.brief),
    '',
    `Title: ${input.premise.title}`,
    `Logline: ${input.premise.logline}`,
    `Synopsis: ${input.premise.synopsis}`,
    `Setting: ${input.premise.setting}`,
    `Main conflict: ${input.premise.mainConflict}`,
    `World rules: ${input.premise.worldRules}`,
    `Premise visual style: ${input.premise.visualStyle}`,
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
    .map(
      (c) =>
        `- ${c.name} (${c.role}, ${c.species}): motivation=${c.motivation}; personality=${c.personality}; fears/flaws=${c.flaws.join(', ') || 'n/a'}; secrets=${c.secrets.join('; ') || 'none'}`,
    )
    .join('\n');

  return [
    'You are the Movie Architect writing the complete story bible arc for ONE movie.',
    CINEMATIC_RULES,
    STORYTELLING_INTELLIGENCE,
    'Plan the ENTIRE movie before production. The ending must be fully specified now.',
    'COMPLETE STORY REQUIREMENTS:',
    '- beginning: simple opening that shows the relationship/situation and plants the conflict.',
    '- middle: misunderstanding or pressure escalates through character choices and dialogue.',
    '- climax: confrontation or reveal that redefines what the audience thought was true.',
    '- resolution + ending: emotional payoff that completes THIS movie (proposal, reconciliation, confession, consequence) — not an incomplete sequel tease.',
    '- Prefer one strong misunderstanding/secret that pays off, not many competing mysteries.',
    '- secrets / reveals / foreshadowingMap: plant the truth early enough that the ending feels earned.',
    '- characterArcs: starting emotion → ending emotion with clear turning points.',
    '- knowledgeMap: be explicit about who knows what (audience may know more or less than characters).',
    '- Write masterPlot in plain English a non-writer can follow.',
    '- Every major event needs a believable reason rooted in character or established facts.',
    '',
    ...formatCreativeBriefBlock(input.brief),
    '',
    `Title: ${input.premise.title}`,
    `Synopsis: ${input.premise.synopsis}`,
    `Setting: ${input.premise.setting}`,
    `Main conflict: ${input.premise.mainConflict}`,
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
    STORYTELLING_INTELLIGENCE,
    `Generate episode outlines ONLY for episodes ${input.fromEpisode} through ${input.toEpisode} inclusive.`,
    'EPISODE OUTLINE REQUIREMENTS:',
    '- Treat episodes as CONNECTED PARTS of one movie (like Part 1 = misunderstanding, Part 2 = truth), not separate short stories.',
    '- Each episode must be understandable alone AND push the movie forward.',
    '- Opening hook, clear dialogue-friendly conflict, emotional change, and a part ending that invites the next episode.',
    '- For short movies (e.g. 60s across 2×30s): Part 1 ends on tension/misunderstanding; final part lands the reveal/resolution.',
    '- For longer movies (up to ~10 minutes): keep the same clarity — more beats, not more confusion.',
    '- Avoid repetitive situations; each episode should change knowledge, relationships, pressure, or power.',
    '- Do not invent filler episodes or unnecessary characters to pad duration.',
    '- The final episode must land the planned resolution/ending cleanly and satisfyingly.',
    '- Continuity notes must track secrets, relationships, and consequences carried forward.',
    '- Write synopsis/hook/cliffhangerOrEnding in plain spoken English.',
    '',
    ...formatCreativeBriefBlock(input.brief),
    '',
    `Title: ${input.premise.title}`,
    `Master plot: ${input.arc.masterPlot}`,
    `Beginning: ${input.arc.beginning}`,
    `Middle: ${input.arc.middle}`,
    `Climax (must be respected in later episodes): ${input.arc.climax}`,
    `Ending (must be respected): ${input.arc.ending}`,
    `Characters: ${names}`,
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
    'You are a Story Quality Evaluator for cinematic episodic movies.',
    'Score craft quality only. Do NOT claim or imply viral performance prediction.',
    `Acceptance threshold (0..1): ${input.acceptanceThreshold}`,
    '',
    'EVALUATION CRITERIA (assess each carefully; put targeted critique in explanations):',
    '- clarity: could a stranger understand the story after one read? Reject confusing/overwritten premises.',
    '- originality: fresh vs stock inheritance/bakery/medical-secret templates unless settings demand them.',
    '- central conflict strength: emotional conflict fits genres/themes (e.g. romance+jealousy = trust vs suspicion).',
    '- characterDepth: small cast of distinct people with clear visual identities and motives.',
    '- emotionalEngagement: empathy, tension, curiosity, earned reveal/payoff.',
    '- believability: human motivations and cause-and-effect (factor into characterDepth/plotCoherence).',
    '- dialoguePotential: can be told in short natural spoken lines — not narrator essay.',
    '- narrative pacing / episodeProgression: connected parts escalate without filler.',
    '- suspense: curiosity/uncertainty where genre-appropriate.',
    '- plotCoherence: reveals earned; no arbitrary twists.',
    '- cliffhangerPayoffQuality / revelation quality: plants and payoffs; climax strength.',
    '- completeStoryResolution: satisfying finished ending for this movie.',
    '- continuity: secrets/knowledge/identity consistent.',
    '- creativeDirectionFit: matches selected genres/themes/audience/tone/language/visual direction.',
    '',
    'ACCEPTANCE RULES (do not rely on overall alone):',
    `- Set accepted=true ONLY if ALL are true: overall >= ${input.acceptanceThreshold}; plotCoherence >= ${input.acceptanceThreshold}; completeStoryResolution >= ${input.acceptanceThreshold}; characterDepth >= ${input.acceptanceThreshold}; emotionalEngagement >= ${input.acceptanceThreshold}; and the story clearly fits the selected creative settings.`,
    '- If rejecting, populate rejectionReasons with TARGETED revision requests (what to fix: conflict, character, ending, pacing, genre fit, etc.).',
    '',
    ...formatCreativeBriefBlock(input.brief),
    '',
    `Title: ${input.premise.title}`,
    `Logline: ${input.premise.logline}`,
    `Synopsis: ${input.premise.synopsis}`,
    `Main conflict: ${input.premise.mainConflict}`,
    `Setting: ${input.premise.setting}`,
    `Beginning: ${input.arc.beginning}`,
    `Middle: ${input.arc.middle}`,
    `Climax: ${input.arc.climax}`,
    `Resolution: ${input.arc.resolution}`,
    `Ending: ${input.arc.ending}`,
    `Major conflicts: ${input.arc.majorConflicts}`,
    `Character arcs: ${JSON.stringify(input.arc.characterArcs)}`,
    `Episode count: ${input.episodeCount}`,
    '',
    'Return scores 0..1 for: originality, characterDepth, emotionalEngagement, suspense, plotCoherence,',
    'episodeProgression, cliffhangerPayoffQuality, dialoguePotential, continuity, completeStoryResolution, overall,',
    'plus explanations (object of strings), accepted (boolean), rejectionReasons (array), note (string).',
  ].join('\n');
}

export function buildSeriesCharacterReferencePrompt(
  character: SeriesCharacterPlan,
  options?: { visualStyle?: string | null },
): string {
  const visualStyle =
    options?.visualStyle?.trim() ||
    'Stylized cinematic 3D cartoon character portrait (Pixar/DreamWorks-like), expressive face, clean design, consistent model-sheet identity — NOT photorealistic.';

  return [
    visualStyle,
    'vertical 9:16 character reference portrait for TikTok/YouTube Shorts,',
    'single character only, centered, simple studio background, identity lock sheet,',
    'same face must be reusable across every episode clip,',
    `name implied identity: ${character.name}, species/type: ${character.species}, age: ${character.ageRange},`,
    character.genderPresentation ? `gender presentation: ${character.genderPresentation},` : '',
    character.skinTone ? `skin tone: ${character.skinTone},` : '',
    character.canonicalVisualDescription,
    `facial structure: ${character.facialStructure}, eyes: ${character.eyeColor} ${character.eyeShape},`,
    `hair/fur: ${character.hairstyle ? `${character.hairstyle}, ` : ''}${character.hairFurColor}`,
    character.facialHair ? `facial hair: ${character.facialHair},` : '',
    `markings: ${character.markings},`,
    `clothing: ${character.clothing}, accessories: ${character.accessories},`,
    'cartoon render, crisp edges, no photoreal skin pores,',
    'no text, no watermark, no collage, no low quality, no live-action photo',
  ]
    .filter(Boolean)
    .join(' ');
}
