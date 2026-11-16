import type {
  EpisodeOutline,
  MovieArchitectBrief,
  MovieArcPlan,
  MovieCharactersPlan,
  MoviePremise,
  StoryQualityScore,
} from './schemas';

export function createMockMoviePremise(brief: MovieArchitectBrief): MoviePremise {
  const theme = brief.theme ?? 'a buried family secret';
  return {
    title: `Echoes of ${brief.genre.split(' ')[0] ?? 'Midnight'}`,
    logline: `When ${theme} resurfaces, unlikely allies must choose loyalty or truth before the final night.`,
    synopsis: `In a rain-soaked city of glass and neon, a fractured family and a watchful outsider collide over ${theme}. Across ${brief.plannedEpisodeCount} episodes, alliances shift, secrets burn, and one irreversible choice decides who survives the truth.`,
    genre: brief.genre,
    subgenres: brief.subgenres.length ? brief.subgenres : ['psychological thriller', 'family drama'],
    targetAudience: brief.targetAudience,
    setting:
      'A near-contemporary coastal megacity of elevated rail lines, flooded lower districts, and private rooftop estates.',
    worldRules:
      'Memory can be recorded into glass tokens, but only the owner can safely unlock them. Stolen tokens corrupt both thief and subject. Public law forbids forced unlocks.',
    mainConflict:
      'A missing sibling left behind a locked memory token that incriminates someone the protagonists love.',
    visualStyle: brief.visualDirection,
  };
}

export function createMockMovieCharacters(brief: MovieArchitectBrief): MovieCharactersPlan {
  void brief;
  return {
    characters: [
      {
        name: 'Mira Solen',
        role: 'PROTAGONIST',
        species: 'human',
        ageRange: '32-36',
        personality: 'Measured, fiercely loyal, quietly ruthless when cornered',
        motivation: 'Recover her brother and keep her remaining family intact',
        backstory: 'Former civic archivist who quit after a token leak destroyed a neighborhood',
        physicalDescription:
          'Lean athletic build, warm medium skin, sharp jaw, controlled posture',
        facialStructure: 'Angular cheekbones, narrow chin, high forehead',
        eyeColor: 'amber-brown',
        eyeShape: 'almond, slightly downturned',
        hairFurColor: 'ink-black, shoulder length, usually tied back',
        markings: 'thin pale scar along right collarbone',
        bodyProportions: '5\'8", long limbs, economical movement',
        clothing: 'Charcoal weatherproof coat, slate turtleneck, practical boots',
        accessories: 'Silver memory-token pendant, cracked leather gloves',
        heightRelative: 'Slightly taller than most supporting cast',
        voiceProfile: 'Low, clear, rarely raised; pauses before hard truths',
        emotionalCharacteristics: 'Grief held in check; flashes of protective fury',
        relationships: [
          {
            withCharacter: 'Jonah Solen',
            relationship: 'younger brother',
            dynamics: 'Protective guilt; she believes she failed him',
          },
          {
            withCharacter: 'Kade Vorn',
            relationship: 'reluctant ally',
            dynamics: 'Distrust turning into mutual dependence',
          },
        ],
        secrets: ['She once illegally unlocked a token for a client'],
        flaws: ['Over-controls information', 'Sacrifices herself too readily'],
        canonicalVisualDescription:
          'Adult woman, ink-black tied-back hair, amber-brown almond eyes, charcoal coat, silver pendant, cinematic 3D realism',
        visualConsistencyNotes:
          'Always keep scar, pendant, coat silhouette, and amber eyes identical across episodes',
      },
      {
        name: 'Kade Vorn',
        role: 'SUPPORTING',
        species: 'anthropomorphic red fox',
        ageRange: '28-32',
        personality: 'Witty, opportunistic, unexpectedly principled under pressure',
        motivation: 'Buy freedom from a debt syndicate using the missing token',
        backstory: 'Smuggler of sealed tokens between flooded districts and rooftop elites',
        physicalDescription:
          'Anthropomorphic fox, upright bipedal, athletic compact frame, expressive muzzle',
        facialStructure: 'Narrow fox face, defined brow ridge, sharp cheek fur patterns',
        eyeColor: 'green-gold',
        eyeShape: 'slanted fox eyes',
        hairFurColor: 'deep auburn fur with cream chest blaze',
        markings: 'white tip on left ear, soot streak across muzzle',
        bodyProportions: 'Shorter than Mira, dense musculature, long bushy tail',
        clothing: 'Olive utility vest, dark scarf, fingerless gloves',
        accessories: 'Brass lockpick charm, fogged goggles on forehead',
        heightRelative: 'About a head shorter than Mira',
        voiceProfile: 'Quick cadence, dry humor, softens when sincere',
        emotionalCharacteristics: 'Masks fear with jokes; loyalty arrives late but sticks',
        relationships: [
          {
            withCharacter: 'Mira Solen',
            relationship: 'ally of convenience',
            dynamics: 'Bargains constantly; respects her discipline',
          },
        ],
        secrets: ['He sold Mira’s brother a forged token map'],
        flaws: ['Self-interested bargains', 'Avoids emotional honesty'],
        canonicalVisualDescription:
          'Anthropomorphic red fox, auburn fur, cream chest, green-gold eyes, olive vest, cinematic 3D, mature design',
        visualConsistencyNotes:
          'Never cartoonish; keep white left ear tip, muzzle soot streak, and vest identical',
      },
      {
        name: 'Jonah Solen',
        role: 'SUPPORTING',
        species: 'human',
        ageRange: '24-27',
        personality: 'Idealistic, impulsive, burdened by guilt',
        motivation: 'Expose the syndicate without destroying his sister',
        backstory: 'Junior engineer who discovered illegal token harvesting',
        physicalDescription: 'Slim, restless energy, boyish face hardening under stress',
        facialStructure: 'Softer jaw than Mira, prominent brows',
        eyeColor: 'dark brown',
        eyeShape: 'round, open',
        hairFurColor: 'messy dark brown curls',
        markings: 'burn mark on left palm from a corrupted token',
        bodyProportions: 'Slightly shorter than Mira, narrower shoulders',
        clothing: 'Faded blue work jacket, layered tees',
        accessories: 'Broken chronometer watch',
        heightRelative: 'Slightly shorter than Mira',
        voiceProfile: 'Faster speech, cracks when lying',
        emotionalCharacteristics: 'Hopeful then panicked; seeks redemption',
        relationships: [
          {
            withCharacter: 'Mira Solen',
            relationship: 'sister',
            dynamics: 'Loves her; hides danger to protect her',
          },
        ],
        secrets: ['He planted the incriminating token to force a public reveal'],
        flaws: ['Impulsive martyr complex'],
        canonicalVisualDescription:
          'Young adult man, messy dark curls, dark brown eyes, blue work jacket, burn mark on left palm',
        visualConsistencyNotes: 'Keep palm burn and broken watch visible in close-ups',
      },
    ],
  };
}

export function createMockMovieArc(
  brief: MovieArchitectBrief,
  premise: MoviePremise,
): MovieArcPlan {
  const last = brief.plannedEpisodeCount;
  return {
    premise: premise.synopsis,
    masterPlot: `${premise.title}: Mira hunts the missing token while Kade bargains for survival and Jonah’s secret plan threatens to burn them all.`,
    beginning: 'Mira receives a corrupted fragment proving Jonah is alive and hunted.',
    middle:
      'Allies form and fracture as token thieves, family loyalty, and forged maps collide; audience learns pieces characters still miss.',
    climax: `Near episode ${Math.max(last - 1, 2)}, the true owner of the locked memory is revealed and Mira must choose exposure or protection.`,
    resolution:
      'The syndicate is broken at a cost; surviving characters carry irreversible knowledge.',
    ending:
      'Mira unlocks the token publicly, clears Jonah, and walks away knowing Kade’s earlier betrayal — choosing uneasy mercy over revenge.',
    majorConflicts:
      'Family loyalty vs public truth; debt freedom vs moral debt; memory ownership vs exploitation.',
    secrets: [
      {
        id: 'secret-token-owner',
        secret: 'The locked token belongs to Mira’s late mentor, not Jonah',
        audienceKnows: false,
        knownByCharacters: [],
        unawareCharacters: ['Mira Solen', 'Jonah Solen', 'Kade Vorn'],
        revealEpisode: Math.max(last - 2, 2),
      },
      {
        id: 'secret-kade-map',
        secret: 'Kade sold Jonah a forged district map',
        audienceKnows: true,
        knownByCharacters: ['Kade Vorn'],
        unawareCharacters: ['Mira Solen', 'Jonah Solen'],
        revealEpisode: Math.ceil(last / 2),
      },
    ],
    reveals: [
      {
        episodeNumber: Math.ceil(last / 2),
        reveal: 'Kade admits the forged map',
        payoffOf: 'secret-kade-map',
      },
      {
        episodeNumber: Math.max(last - 2, 2),
        reveal: 'Mentor ownership of the token',
        payoffOf: 'secret-token-owner',
      },
    ],
    foreshadowingMap: [
      {
        plantEpisode: 1,
        payoffEpisode: Math.max(last - 2, 2),
        detail: 'Mentor’s glass seal pattern appears in the fragment',
      },
      {
        plantEpisode: 2,
        payoffEpisode: Math.ceil(last / 2),
        detail: 'Kade avoids certain alleys he claims not to know',
      },
    ],
    characterArcs: [
      {
        character: 'Mira Solen',
        startingState: 'Controller of information',
        endingState: 'Chooses transparent truth with mercy',
        keyTurningPoints: ['Receives fragment', 'Learns Kade’s lie', 'Public unlock'],
      },
      {
        character: 'Kade Vorn',
        startingState: 'Self-serving smuggler',
        endingState: 'Ally who accepts consequences',
        keyTurningPoints: ['Debt pressure', 'Confession', 'Final stand'],
      },
    ],
    knowledgeMap: {
      audience: ['Kade sold a forged map'],
      byCharacter: [
        {
          character: 'Mira Solen',
          knows: ['Jonah is alive'],
          doesNotKnow: ['Token owner identity', 'Kade forged the map'],
        },
        {
          character: 'Kade Vorn',
          knows: ['Forged map', 'Syndicate routes'],
          doesNotKnow: ['Token owner identity'],
        },
        {
          character: 'Jonah Solen',
          knows: ['Syndicate harvest plan'],
          doesNotKnow: ['Mira’s illegal unlock past'],
        },
      ],
    },
  };
}

export function createMockEpisodeOutlines(
  brief: MovieArchitectBrief,
  fromEpisode: number,
  toEpisode: number,
): EpisodeOutline[] {
  const episodes: EpisodeOutline[] = [];
  for (let n = fromEpisode; n <= toEpisode; n++) {
    const isFinale = n === brief.plannedEpisodeCount;
    episodes.push({
      episodeNumber: n,
      title: isFinale ? 'The Unlocked Night' : `Token ${n}`,
      synopsis: isFinale
        ? 'Mira unlocks the memory publicly and chooses mercy over revenge as the syndicate falls.'
        : `Episode ${n} advances the hunt for the locked token and tightens pressure on Mira and Kade.`,
      hook: n === 1 ? 'A corrupted fragment whispers Jonah’s name.' : `A new lead appears — and a cost.`,
      keyPlotDevelopment: isFinale
        ? 'Public unlock resolves ownership and exposes the syndicate.'
        : `A clue reshapes who Mira trusts in episode ${n}.`,
      emotionalBeat: isFinale ? 'Relief laced with irreversible loss' : 'Suspicion under loyalty',
      cliffhangerOrEnding: isFinale
        ? 'Quiet aftermath; Mira walks into rain with the truth known.'
        : 'A door opens onto a threat Mira cannot yet name.',
      nextEpisodeSetup: isFinale
        ? 'Series complete; aftermath seeds optional future conflict.'
        : 'The next district and a missing witness are named.',
      charactersFeatured: ['Mira Solen', 'Kade Vorn', ...(n % 3 === 0 ? ['Jonah Solen'] : [])],
      reveals: n === Math.ceil(brief.plannedEpisodeCount / 2) ? ['Kade forged the map'] : [],
      continuityNotes: `Preserve prior injuries, token fragment state, and who knows what as of episode ${n - 1 || 1}.`,
    });
  }
  return episodes;
}

export function createMockStoryQualityScore(accepted = true): StoryQualityScore {
  const base = accepted ? 0.82 : 0.55;
  return {
    originality: base,
    characterDepth: base + 0.02,
    emotionalEngagement: base,
    suspense: base - 0.02,
    plotCoherence: base + 0.05,
    episodeProgression: base,
    cliffhangerPayoffQuality: base - 0.01,
    dialoguePotential: base,
    continuity: base + 0.04,
    completeStoryResolution: accepted ? 0.88 : 0.4,
    overall: accepted ? 0.83 : 0.52,
    explanations: {
      overall: accepted
        ? 'Coherent complete-movie arc with character-driven stakes.'
        : 'Resolution and continuity are too weak for acceptance.',
    },
    accepted,
    rejectionReasons: accepted ? [] : ['completeStoryResolution below threshold'],
    note: 'Scores measure story craft only. They do not predict audience reach or viral performance.',
  };
}
