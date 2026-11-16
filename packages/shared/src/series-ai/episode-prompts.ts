import { SERIES_DEFAULTS } from '../series/constants';

export function buildEpisodeScriptPrompt(input: {
  seriesTitle: string;
  episodeNumber: number;
  plannedEpisodeCount: number;
  targetDurationSeconds: number;
  outlineTitle: string;
  outlineSynopsis: string;
  outlineHook?: string | null;
  outlineKeyPlot?: string | null;
  outlineCliffhanger?: string | null;
  outlineNextSetup?: string | null;
  bibleDigest: string;
  characterDigest: string;
  previousEpisodeSummary: string;
  continuityDigest: string;
  memoryDigest: string;
  unresolvedMysteries: string;
  relationshipsDigest: string;
  visualRefsDigest: string;
}): string {
  const wordMin = Math.round(
    (SERIES_DEFAULTS.spokenWordsPerSixtySecondsMin * input.targetDurationSeconds) / 60,
  );
  const wordMax = Math.round(
    (SERIES_DEFAULTS.spokenWordsPerSixtySecondsMax * input.targetDurationSeconds) / 60,
  );

  return [
    'You are the Episode Director for a cinematic episodic drama series.',
    'Write ONE interconnected episode of a complete movie — not a standalone short story.',
    'Respect canon: characters must not know secrets they have not discovered.',
    'Do not change approved character appearance or identity.',
    'Visual direction: mature premium cinematic 3D animation.',
    'Return ONE JSON object only. No markdown fences.',
    '',
    `Series: ${input.seriesTitle}`,
    `Episode ${input.episodeNumber} of ${input.plannedEpisodeCount}`,
    `Target duration seconds: ${input.targetDurationSeconds}`,
    `Target spoken words roughly ${wordMin}-${wordMax} (clarity over exact count).`,
    '',
    `Outline title: ${input.outlineTitle}`,
    `Outline synopsis: ${input.outlineSynopsis}`,
    input.outlineHook ? `Outline hook: ${input.outlineHook}` : '',
    input.outlineKeyPlot ? `Key plot development: ${input.outlineKeyPlot}` : '',
    input.outlineCliffhanger ? `Planned ending/cliffhanger: ${input.outlineCliffhanger}` : '',
    input.outlineNextSetup ? `Next episode setup: ${input.outlineNextSetup}` : '',
    '',
    'Series bible digest:',
    input.bibleDigest,
    '',
    'Canonical characters:',
    input.characterDigest,
    '',
    'Approved visual references:',
    input.visualRefsDigest || 'None yet — still keep canonical descriptions exact.',
    '',
    'Previous episode summary:',
    input.previousEpisodeSummary || 'This is Episode 1 — open from the series beginning.',
    '',
    'Latest continuity snapshot:',
    input.continuityDigest || 'No prior snapshot — initialize carefully from bible.',
    '',
    'Relevant memory events:',
    input.memoryDigest || 'None yet.',
    '',
    'Unresolved mysteries:',
    input.unresolvedMysteries || 'None listed.',
    '',
    'Current relationships:',
    input.relationshipsDigest || 'Use character relationship canon.',
    '',
    'Episode craft:',
    '- Compelling opening hook',
    '- Meaningful progression and character-driven conflict',
    '- Emotional or suspenseful development',
    '- Satisfying episode-level payoff',
    '- Unresolved question or cliffhanger when appropriate (not every episode needs extreme cliffhanger)',
    '',
    'Required keys: episodeNumber, title, synopsis, hook, narrationText, script, ending, cliffhanger,',
    'nextEpisodeSetup, keyPlotDevelopment, emotionalBeats, spokenWordCount, scenes, continuityChanges, memoryEvents.',
    'Each scene needs sceneOrder, location, characters, action, visualDescription, dialogue, narration,',
    'emotionalDirection, shotDirection.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildContinuityValidationPrompt(input: {
  stage: 'pre_script_approval' | 'pre_visual';
  seriesTitle: string;
  episodeNumber: number;
  episodeScriptDigest: string;
  bibleDigest: string;
  characterDigest: string;
  continuityDigest: string;
  memoryDigest: string;
}): string {
  return [
    'You are the Continuity Validator for a cinematic episodic series.',
    `Validation stage: ${input.stage}`,
    'Detect contradictions with established canon. Do not rewrite canon.',
    'Characters must not know information they have not discovered.',
    'Return ONE JSON object: valid, stage, issues[], summary.',
    'Each issue: code, severity (error|warning), message, optional conflictingEvent, optional suggestedFix.',
    'Set valid=false if any severity=error issues exist.',
    '',
    `Series: ${input.seriesTitle}`,
    `Episode: ${input.episodeNumber}`,
    '',
    'Bible digest:',
    input.bibleDigest,
    '',
    'Characters:',
    input.characterDigest,
    '',
    'Continuity snapshot:',
    input.continuityDigest,
    '',
    'Memory events:',
    input.memoryDigest,
    '',
    'Episode script digest:',
    input.episodeScriptDigest,
  ].join('\n');
}
