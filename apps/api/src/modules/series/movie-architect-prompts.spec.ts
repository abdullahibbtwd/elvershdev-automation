import {
  buildEpisodeOutlinesPrompt,
  buildMovieArcPrompt,
  buildMovieCharactersPrompt,
  buildMoviePremisePrompt,
  buildSeriesCharacterReferencePrompt,
  buildStoryQualityPrompt,
  creativeSettingsToBriefFields,
  seriesCreativeSettingsSchema,
  type MovieArchitectBrief,
  type MovieArcPlan,
  type MoviePremise,
  type SeriesCharacterPlan,
} from '@ai-video/shared';

const brief: MovieArchitectBrief = {
  genre: 'Mystery thriller',
  subgenres: ['Suspense'],
  theme: 'Hidden secrets; Deception',
  targetAudience: 'Adult viewers',
  language: 'en',
  tone: 'Tense and intimate',
  visualDirection: 'Noir-lit semi-realistic cinematic 3D with rain-slick streets',
  plannedEpisodeCount: 4,
  targetEpisodeDurationSeconds: 30,
  targetStoryDurationSeconds: 120,
  maxClipDurationSeconds: 15,
  productionFormat: 'episodic',
  additionalInstructions: 'Dialogue density: high\nDialogue style: clipped natural speech',
  ideaMode: 'generate',
};

const premise: MoviePremise = {
  title: 'The Night Ledger',
  logline: 'A night auditor finds a ledger that proves her boss is erasing people from the books.',
  synopsis: 'Maya discovers altered guest records and must decide whether to expose the hotel.',
  genre: 'Mystery thriller',
  subgenres: ['Suspense'],
  targetAudience: 'Adult viewers',
  setting: 'A coastal boutique hotel at 3 a.m.',
  worldRules: 'Contemporary realism; no supernatural events.',
  mainConflict: 'Maya must prove the ledger is real before she is framed as the thief.',
  visualStyle: 'Noir-lit semi-realistic cinematic 3D with rain-slick streets',
};

const character: SeriesCharacterPlan = {
  name: 'Maya Okonkwo',
  role: 'PROTAGONIST',
  species: 'Human',
  ageRange: '32',
  genderPresentation: 'female',
  skinTone: 'deep brown',
  personality: 'Careful, stubborn, quietly angry',
  motivation: 'Protect her job and her integrity',
  backstory: 'Former bank clerk who took night work after a layoff',
  physicalDescription: 'Lean build, tired eyes',
  facialStructure: 'Angular cheekbones',
  eyeColor: 'dark brown',
  eyeShape: 'almond',
  hairstyle: 'tight cornrows',
  hairFurColor: 'black',
  facialHair: '',
  markings: 'small scar on left eyebrow',
  bodyProportions: 'Athletic lean',
  clothing: 'Navy staff blazer over white shirt',
  accessories: 'Silver watch',
  heightRelative: 'Average',
  voiceProfile: 'Low clear alto',
  emotionalCharacteristics: 'Guarded empathy',
  relationships: [],
  secrets: ['She once covered a prior cash shortfall'],
  flaws: ['Avoids asking for help'],
  canonicalVisualDescription: 'Adult woman, deep brown skin, cornrows, navy blazer',
  visualConsistencyNotes: 'Keep scar and watch consistent',
};

const arc: MovieArcPlan = {
  premise: premise.synopsis,
  masterPlot: 'Maya investigates the ledger and confronts the manager.',
  beginning: 'Maya finds the altered ledger.',
  middle: 'Threats escalate; a guest disappears from records.',
  climax: 'Maya broadcasts the proof during morning shift change.',
  resolution: 'The manager is arrested; Maya keeps her job but loses trust in systems.',
  ending: 'Maya locks the night office and walks into rain with a clean copy of the ledger.',
  majorConflicts: 'Truth vs livelihood; loyalty vs fear',
  secrets: [],
  reveals: [],
  foreshadowingMap: [],
  characterArcs: [
    {
      character: 'Maya Okonkwo',
      startingState: 'Avoidant survivor',
      endingState: 'Reluctant whistleblower',
      keyTurningPoints: ['Guest deletion confirmed'],
    },
  ],
  knowledgeMap: { audience: [], byCharacter: [] },
};

describe('Movie Architect storytelling prompts', () => {
  it('premise prompt requires emotional conflict and selected creative settings', () => {
    const prompt = buildMoviePremisePrompt(brief);
    expect(prompt).toContain('STORYTELLING INTELLIGENCE');
    expect(prompt).toContain('Mystery thriller');
    expect(prompt).toContain('Noir-lit semi-realistic cinematic 3D');
    expect(prompt).toContain('Do NOT build a plot by merely listing');
    expect(prompt).toContain('visualStyle MUST follow the selected Visual direction');
  });

  it('character and arc prompts require development and complete endings', () => {
    expect(buildMovieCharactersPrompt({ brief, premise })).toContain(
      'PROTAGONIST with clear wants, fears, and emotional stakes',
    );
    expect(buildMovieArcPrompt({ brief, premise, characters: [character] })).toContain(
      'emotional payoff that completes THIS movie',
    );
  });

  it('episode and quality prompts enforce progression and multi-gate acceptance', () => {
    expect(
      buildEpisodeOutlinesPrompt({
        brief,
        premise,
        arc,
        characters: [character],
        fromEpisode: 1,
        toEpisode: 4,
      }),
    ).toContain('land the planned resolution/ending');

    const quality = buildStoryQualityPrompt({
      brief,
      premise,
      arc,
      episodeCount: 4,
      acceptanceThreshold: 0.75,
    });
    expect(quality).toContain('do not rely on overall alone');
    expect(quality).toContain('creativeDirectionFit');
    expect(quality).toContain('TARGETED revision requests');
  });

  it('character reference prompt uses lane visual style', () => {
    const prompt = buildSeriesCharacterReferencePrompt(character, {
      visualStyle: brief.visualDirection,
    });
    expect(prompt.startsWith(brief.visualDirection)).toBe(true);
  });

  it('creative brief mapping keeps storytelling intelligence instructions', () => {
    const fields = creativeSettingsToBriefFields(
      seriesCreativeSettingsSchema.parse({
        genres: ['Family drama'],
        themes: ['Betrayal'],
        visualStyle: 'Semi-realistic cinematic 3D',
      }),
    );
    expect(fields.additionalInstructions).toMatch(/emotionally engaging short movie/i);
    expect(fields.visualDirection).toContain('Semi-realistic');
  });
});
