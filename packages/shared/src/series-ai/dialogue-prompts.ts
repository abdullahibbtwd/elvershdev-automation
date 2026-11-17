import { SERIES_DEFAULTS } from '../series/constants';
import type { SeriesCreativeSettings } from '../series/creative-settings';

export function buildDialogueEpisodeScriptPrompt(input: {
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
  revisionNotes?: string;
  creative?: SeriesCreativeSettings;
  languageStyleNotes?: string;
}): string {
  const wordMin = Math.round(
    (SERIES_DEFAULTS.spokenWordsPerSixtySecondsMin * input.targetDurationSeconds) / 60,
  );
  const wordMax = Math.round(
    (SERIES_DEFAULTS.spokenWordsPerSixtySecondsMax * input.targetDurationSeconds) / 60,
  );
  const allowNarration = input.creative?.narrationPreference === 'allowed';
  const density = input.creative?.dialogueDensity ?? 'high';

  return [
    'You are the Episode Director for a dialogue-driven cinematic animated series.',
    'Write ONE interconnected episode of a complete movie — not a standalone short story.',
    'CRITICAL: Characters must speak directly to one another. This is an animated movie scene, not a narrated slideshow.',
    allowNarration
      ? 'Narration is allowed only when explicitly needed for a creative purpose. Prefer character dialogue.'
      : 'Do NOT use a narrator. Set narrationText to "" and scene narration to "". Story advances only through dialogue, action, and reaction.',
    'Respect canon: characters must not know secrets they have not discovered.',
    'Do not change approved character appearance or identity.',
    'Visual direction: semi-realistic cinematic 3D animation with human proportions — not a childish cartoon.',
    'Return ONE JSON object only. No markdown fences.',
    '',
    `Series: ${input.seriesTitle}`,
    `Episode ${input.episodeNumber} of ${input.plannedEpisodeCount}`,
    `Target duration seconds: ${input.targetDurationSeconds}`,
    `Target spoken words roughly ${wordMin}-${wordMax}.`,
    `Dialogue density: ${density}.`,
    '',
    `Outline title: ${input.outlineTitle}`,
    `Outline synopsis: ${input.outlineSynopsis}`,
    input.outlineHook ? `Outline hook: ${input.outlineHook}` : '',
    input.outlineKeyPlot ? `Key plot development: ${input.outlineKeyPlot}` : '',
    input.outlineCliffhanger ? `Planned ending/cliffhanger: ${input.outlineCliffhanger}` : '',
    input.outlineNextSetup ? `Next episode setup: ${input.outlineNextSetup}` : '',
    input.revisionNotes ? `\nRevision required:\n${input.revisionNotes}\n` : '',
    '',
    'Series bible digest:',
    input.bibleDigest,
    '',
    'Canonical characters (use EXACT names as speakers):',
    input.characterDigest,
    '',
    'Approved visual references:',
    input.visualRefsDigest || 'None yet — keep canonical descriptions exact.',
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
    'Language & dialogue:',
    '- Use clear, natural spoken English that real people would say aloud.',
    '- Prefer short sentences. Everyday life conversations.',
    '- Show emotion through what characters say and how they say it.',
    input.languageStyleNotes ? `Creative language settings:\n${input.languageStyleNotes}` : '',
    input.creative?.visualStyle ? `Visual style: ${input.creative.visualStyle}` : '',
    input.creative?.cinematicShotStyle
      ? `Cinematic shot style: ${input.creative.cinematicShotStyle}`
      : '',
    input.creative?.characterAnimationStyle
      ? `Character animation style: ${input.creative.characterAnimationStyle}`
      : '',
    '',
    'Shot craft (mandatory):',
    '- Divide the episode into multiple short cinematic shots (not one continuous clip).',
    '- Every dialogue line MUST name an exact character as speaker.',
    '- Alternate camera angles for conversations (shot / reverse shot).',
    '- Include reaction shots when useful (dialogue may be empty; requiresLipSync=false).',
    '- Speaking shots: requiresLipSync=true and non-empty dialogue.',
    '- Cost discipline: only speaking shots use expensive lip-sync video. Reaction / wide / insert shots are short and silent.',
    '- Keep total speaking duration roughly 30–45% of the episode target (enough for story, not wall-to-wall talk).',
    '- Do not make two characters speak in the same shot unless the script explicitly requires overlapping speech.',
    '- Include facialExpression, bodyLanguage, cameraDirection, environment, lighting, durationSeconds.',
    '- Scene total durations should sum near the episode target.',
    '',
    'Episode craft:',
    '- Opening hook within the first shots',
    '- One clear conflict developed through conversation',
    '- Emotional peak',
    '- Ending cliffhanger / development that pulls to the next episode',
    '',
    'Required top-level keys: episodeNumber, title, synopsis, hook, ending, cliffhanger,',
    'nextEpisodeSetup, keyPlotDevelopment, emotionalBeats, spokenWordCount, script, narrationText,',
    'scenes, continuityChanges, memoryEvents.',
    'Each scene needs sceneNumber, durationSeconds, location, characters, backgroundEnvironment,',
    'emotionalDirection, action, visualDescription, shots[].',
    'Each shot needs shotOrder, shotType, speaker, dialogue, emotion, facialExpression, bodyLanguage,',
    'cameraDirection, charactersVisible, environment, durationSeconds, requiresLipSync.',
  ]
    .filter(Boolean)
    .join('\n');
}
