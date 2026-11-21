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
  const isFinale = input.episodeNumber >= input.plannedEpisodeCount;

  return [
    'You are the Episode Director for a dialogue-driven cinematic short movie.',
    'Write ONE connected PART of a complete movie — not a standalone short and not a confusing literary script.',
    'QUALITY BAR: a stranger must understand this episode after one read. Clear conflict. Short spoken lines. Readable emotions.',
    'CRITICAL: Characters speak directly to one another. This is a movie scene, not a narrated slideshow.',
    allowNarration
      ? 'Narration is allowed only when explicitly needed. Prefer character dialogue.'
      : 'Do NOT use a narrator. Set narrationText to "" and scene narration to "". Never invent a NARRATOR speaker. Story advances only through dialogue, action, and reaction.',
    'Respect canon: characters must not know secrets they have not discovered.',
    'Do not change approved character appearance or identity.',
    'Visual direction follows the series creative visual style (stylized cartoon by default unless settings say otherwise).',
    'Return ONE JSON object only. No markdown fences.',
    '',
    `Series: ${input.seriesTitle}`,
    `Episode ${input.episodeNumber} of ${input.plannedEpisodeCount}` +
      (isFinale ? ' (FINAL PART — land the reveal/resolution)' : ' (CONNECTED PART — end on tension that continues)'),
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
    'Language & dialogue (mandatory):',
    '- Clear everyday spoken English only. Write like real people arguing or whispering in a room.',
    '- Good: “Who\'s Maya?” / “It\'s not what you think.” / “You told me there was nobody else!”',
    '- Bad: long poetic speeches, legal essays, narrator summaries, or lines packed with exposition.',
    '- Prefer short sentences. One idea per line. Emotion comes from wording + expression, not fancy vocabulary.',
    '- The top-level script field MUST be CHARACTER: line format only (e.g. ELENA: Who is Claire?).',
    '- Do NOT write literary screenplay cues (no “ELENA” alone on a line, no SCENE 1 - INT. blocks inside script).',
    '- Put every spoken line into shots[].dialogue with requiresLipSync=true so Grok receives real speech, not buried stage directions.',
    input.languageStyleNotes ? `Creative language settings:\n${input.languageStyleNotes}` : '',
    input.creative?.dialogueStyle ? `Dialogue style: ${input.creative.dialogueStyle}` : '',
    input.creative?.visualStyle ? `Visual style: ${input.creative.visualStyle}` : '',
    input.creative?.cinematicShotStyle
      ? `Cinematic shot style: ${input.creative.cinematicShotStyle}`
      : '',
    input.creative?.characterAnimationStyle
      ? `Character animation style: ${input.creative.characterAnimationStyle}`
      : '',
    '',
    'Shot craft (mandatory for Grok ≤15s packs):',
    '- Divide the episode into multiple short cinematic shots (not one continuous clip).',
    '- Keep actions simple and filmable: sit, stand, open door, read phone, hand gift/ring, walk away, look shocked.',
    '- Every dialogue line MUST name an exact character as speaker (never NARRATOR).',
    '- Alternate camera angles for conversations (shot / reverse shot).',
    '- Include reaction shots when useful (dialogue may be empty; requiresLipSync=false).',
    '- Reaction / silent shots: speaker = reacting character or empty; dialogue="".',
    '- Speaking shots: requiresLipSync=true, non-empty dialogue, exact character name.',
    '- continuityChanges arrays may be empty []; never include placeholder objects with missing fields.',
    '- Cost discipline: only speaking shots need lip-sync; reactions/inserts stay short and silent.',
    '- Keep total speaking duration roughly 30–45% of the episode target.',
    '- Do not make two characters speak in the same shot unless overlapping speech is required.',
    '- Include facialExpression, bodyLanguage, cameraDirection, environment, lighting, durationSeconds, keyProps.',
    '- Scene total durations should sum near the episode target.',
    '',
    'Props / key objects (mandatory for EVERY story — not optional flavor):',
    '- If the plot depends on a physical object (phone, ring, letter, keys, gift, photo, bag, laptop, flowers, etc.), that object MUST appear on camera.',
    '- Put those objects in shot.keyProps as short concrete nouns (e.g. ["smartphone","engagement ring"]).',
    '- bodyLanguage must say how the object is used: holding phone screen toward camera, sliding ring box open, handing letter, etc.',
    '- When an object reveals the twist or carries emotion, add a short silent insert/close-up shot of that object (shotType=insert or close_up, dialogue="").',
    '- Never rely on characters only talking about an object that never appears in frame.',
    '- Scene.action and scene.visualDescription must name the same visible props.',
    '',
    'Episode craft:',
    '- Opening hook in the first shots',
    '- One clear conflict through conversation',
    '- Emotional peak (anger, fear, hope, shock)',
    isFinale
      ? '- FINAL episode: reveal the truth and land a satisfying ending (apology, proposal, reconciliation, consequence)'
      : '- Non-final episode: end on tension/misunderstanding that pulls to the next part (not a fake open ending)',
    '',
    'Required top-level keys: episodeNumber, title, synopsis, hook, ending, cliffhanger,',
    'nextEpisodeSetup, keyPlotDevelopment, emotionalBeats, spokenWordCount, script, narrationText,',
    'scenes, continuityChanges, memoryEvents.',
    'Each scene needs sceneNumber, durationSeconds, location, characters, backgroundEnvironment,',
    'emotionalDirection, action, visualDescription, shots[].',
    'Each shot needs shotOrder, shotType, speaker, dialogue, emotion, facialExpression, bodyLanguage,',
    'cameraDirection, charactersVisible, environment, durationSeconds, requiresLipSync, keyProps.',
  ]
    .filter(Boolean)
    .join('\n');
}
