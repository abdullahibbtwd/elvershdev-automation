/**
 * Phase 3: turn approved screenplay shots into Grok Lite clip plans (≤15s each).
 * Shot-aware packing: preserve dialogue, avoid mid-sentence cuts when possible,
 * split long shots into connected clips with continuity context.
 * Each clip must cover a DISTINCT beat — never reuse the full episode synopsis for every pack.
 */

import {
  formatCharacterIdentityForClipPrompt,
  seriesCharacterToIdentityProfile,
  type SeriesCharacterIdentityProfile,
} from './character-identity';
import {
  SERIES_DURATION_DEFAULTS,
  planClipDurationsForEpisode,
} from './duration-plan';

export const EPISODE_VIDEO_CLIP_STATUSES = [
  'PLANNED',
  'QUEUED',
  'SUBMITTED',
  'GENERATING',
  'DOWNLOADING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED',
] as const;

export type EpisodeVideoClipStatusName = (typeof EPISODE_VIDEO_CLIP_STATUSES)[number];

export type ClipPlanShotInput = {
  id?: string;
  sceneOrder: number;
  shotOrder: number;
  shotType?: string | null;
  speakerName?: string | null;
  dialogue?: string | null;
  charactersVisible?: string[];
  cameraDirection?: string | null;
  cameraMovement?: string | null;
  facialExpression?: string | null;
  bodyLanguage?: string | null;
  environment?: string | null;
  lighting?: string | null;
  durationSeconds: number;
  ambientSound?: string | null;
  musicDirection?: string | null;
  location?: string | null;
  /** Optional scene action / visual description for richer prompts. */
  sceneAction?: string | null;
  /** Physical story objects that must appear on camera in this shot. */
  keyProps?: string[];
};

export type ClipPlanEpisodeContext = {
  episodeNumber: number;
  episodeTitle: string;
  episodeSummary?: string | null;
  /** Full readable screenplay (CHARACTER: line). Used when shots are missing. */
  episodeScript?: string | null;
  targetDurationSeconds: number;
  maxClipDurationSeconds?: number;
  visualStyle?: string | null;
  aspectRatio?: string | null;
  pricePerSecondUsd?: number;
};

export type PlannedEpisodeClip = {
  clipIndex: number;
  sceneOrder: number;
  shotOrders: number[];
  sourceShotIds: string[];
  durationSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  characters: string[];
  speakerName: string | null;
  dialogue: string;
  location: string;
  environment: string;
  camera: string;
  action: string;
  /** Story props that must be visible in this Grok pack (phone, ring, etc.). */
  keyProps: string[];
  audioDirection: string;
  musicDirection: string;
  previousClipSummary: string | null;
  nextClipHint: string | null;
  prompt: string;
  continuity: {
    location: string;
    clothingNotes: string;
    charactersPresent: string[];
    actionsCompleted: string[];
    actionsContinuing: string[];
  };
};

export type EpisodeClipPlanResult = {
  clips: PlannedEpisodeClip[];
  totalDurationSeconds: number;
  maxClipDurationSeconds: number;
  clipCount: number;
  estimatedCostUsd: number;
  pricePerSecondUsd: number;
  notes: string[];
};

function clampDuration(value: number, maxClip: number): number {
  if (!Number.isFinite(value) || value <= 0) return Math.min(4, maxClip);
  return Math.min(maxClip, Math.max(1, Math.round(value * 10) / 10));
}

function asNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

/** Common plot props to surface when scripts mention them but keyProps was empty. */
const STORY_PROP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bengagement\s+ring\b/i, label: 'engagement ring' },
  { re: /\bwedding\s+ring\b/i, label: 'wedding ring' },
  { re: /\bring\s+box\b/i, label: 'ring box' },
  { re: /\bring\b/i, label: 'ring' },
  { re: /\b(smart)?phone\b/i, label: 'smartphone' },
  { re: /\bmobile\s+phone\b/i, label: 'smartphone' },
  { re: /\btext\s+message\b/i, label: 'phone text message' },
  { re: /\bletter\b/i, label: 'letter' },
  { re: /\benvelope\b/i, label: 'envelope' },
  { re: /\bphoto(graph)?\b/i, label: 'photo' },
  { re: /\bcar\s+keys?\b/i, label: 'car keys' },
  { re: /\bkeys?\b/i, label: 'keys' },
  { re: /\bgift\s+box\b/i, label: 'gift box' },
  { re: /\bgift\b/i, label: 'gift' },
  { re: /\bbouquet\b|\bflowers?\b/i, label: 'flowers' },
  { re: /\bnecklace\b/i, label: 'necklace' },
  { re: /\bbracelet\b/i, label: 'bracelet' },
  { re: /\bwatch\b/i, label: 'watch' },
  { re: /\bwallet\b/i, label: 'wallet' },
  { re: /\bpurse\b|\bhandbag\b/i, label: 'purse' },
  { re: /\bbackpack\b|\bbag\b/i, label: 'bag' },
  { re: /\blaptop\b/i, label: 'laptop' },
  { re: /\btablet\b/i, label: 'tablet' },
  { re: /\bnotebook\b|\bdiary\b/i, label: 'notebook' },
  { re: /\bcoffee\s+cup\b|\bmug\b/i, label: 'coffee mug' },
];

/**
 * Collect visible story props from explicit keyProps plus mentions in action/dialogue text.
 * Used so every story (not only one episode) keeps phones/rings/etc. on camera for Grok.
 */
export function collectVisibleStoryProps(
  explicit: string[] | undefined,
  ...texts: Array<string | null | undefined>
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(label);
  };

  for (const item of explicit ?? []) push(item);

  const blob = texts.filter(Boolean).join(' \n ');
  if (blob.trim()) {
    for (const { re, label } of STORY_PROP_PATTERNS) {
      if (re.test(blob)) push(label);
    }
  }
  return found.slice(0, 12);
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const SPOKEN_WORDS_PER_SECOND = 2.2;
/** Max spoken words Grok can realistically deliver in one ≤15s pack. */
const MAX_SPOKEN_WORDS_PER_CLIP = 32;

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isSceneHeader(line: string): boolean {
  return /^(SCENE\s*\d+|INT\.|EXT\.|I\/E\.|FADE|CUT TO)/i.test(line);
}

function isCharacterCue(line: string): boolean {
  // Literary cue: ELENA or LEO alone on a line (not a sentence).
  if (!/^[A-Z][A-Z0-9' .-]{1,40}$/.test(line)) return false;
  if (isSceneHeader(line)) return false;
  if (/\b(NIGHT|DAY|CONTINUOUS|LATER|MORNING|EVENING)\b/.test(line)) return false;
  return true;
}

/**
 * Parse literary or `NAME: line` screenplays into timed speaking/action shots.
 * This is what makes Grok hear “Who is Claire?” instead of burying it in ACTION.
 */
export function screenplayToClipShots(
  script: string,
  options?: { targetDurationSeconds?: number; maxClipDurationSeconds?: number },
): ClipPlanShotInput[] {
  const raw = script.replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Also expand inline "LEO: … ELENA: …" blocks into lines when few newlines exist.
  const expanded: string[] = [];
  for (const line of lines) {
    if (
      line.includes(':') &&
      /[A-Z][A-Za-z][A-Za-z0-9'._-]{0,38}:\s/.test(line) &&
      (line.match(/[A-Z][A-Za-z][A-Za-z0-9'._-]{0,38}:\s/g)?.length ?? 0) >= 2
    ) {
      expanded.push(
        ...line
          .split(/(?<=^|[\s.!?])(?=[A-Z][A-Za-z][A-Za-z0-9'._-]{0,38}(?:\s+[A-Z][A-Za-z0-9'._-]{1,40}){0,3}:\s)/)
          .map((part) => part.trim())
          .filter(Boolean),
      );
    } else {
      expanded.push(line);
    }
  }

  type Beat = {
    kind: 'dialogue' | 'action';
    speaker?: string;
    text: string;
    sceneOrder: number;
  };
  const beats: Beat[] = [];
  let sceneOrder = 1;
  let pendingSpeaker: string | null = null;

  for (const line of expanded) {
    if (isSceneHeader(line)) {
      const sceneMatch = line.match(/SCENE\s*(\d+)/i);
      if (sceneMatch) sceneOrder = Math.max(1, Number(sceneMatch[1]));
      else sceneOrder += beats.length ? 1 : 0;
      pendingSpeaker = null;
      // Keep short location slug as silent establishing action
      const loc = line.replace(/^SCENE\s*\d+\s*[-–—:]?\s*/i, '').trim();
      if (loc.length > 3) {
        beats.push({ kind: 'action', text: loc, sceneOrder });
      }
      continue;
    }

    const named = line.match(
      /^([A-Z][A-Za-z][A-Za-z0-9'._-]{0,38}(?:\s+[A-Z][A-Za-z0-9'._-]{1,40}){0,3})\s*:\s+(.+)$/,
    );
    if (named) {
      pendingSpeaker = null;
      beats.push({
        kind: 'dialogue',
        speaker: named[1]!.trim(),
        text: named[2]!.trim(),
        sceneOrder,
      });
      continue;
    }

    if (isCharacterCue(line)) {
      pendingSpeaker = line.trim();
      continue;
    }

    if (pendingSpeaker) {
      beats.push({
        kind: 'dialogue',
        speaker: pendingSpeaker,
        text: line,
        sceneOrder,
      });
      pendingSpeaker = null;
      continue;
    }

    // Skip pure transitions; keep visual action lines
    if (line.length > 8) {
      beats.push({ kind: 'action', text: line, sceneOrder });
    }
  }

  if (!beats.some((b) => b.kind === 'dialogue')) {
    return [];
  }

  const maxClip = Math.min(
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    Math.max(1, options?.maxClipDurationSeconds ?? SERIES_DURATION_DEFAULTS.maxClipDurationSeconds),
  );

  const shots: ClipPlanShotInput[] = [];
  let shotOrder = 1;
  for (const beat of beats) {
    if (beat.kind === 'dialogue') {
      const words = countWords(beat.text);
      const durationSeconds = clampDuration(
        Math.max(3, Math.min(maxClip, words / SPOKEN_WORDS_PER_SECOND + 1.5)),
        maxClip,
      );
      const keyProps = collectVisibleStoryProps(undefined, beat.text);
      shots.push({
        sceneOrder: beat.sceneOrder,
        shotOrder: shotOrder++,
        shotType: 'medium_close_up',
        speakerName: beat.speaker ?? null,
        dialogue: beat.text,
        charactersVisible: beat.speaker ? [beat.speaker] : [],
        cameraDirection: `Close on ${beat.speaker ?? 'speaker'} while they speak this line only`,
        facialExpression: 'emotion matching the line',
        bodyLanguage: keyProps.length
          ? `natural speaking performance while clearly holding/showing ${keyProps.join(' and ')}`
          : 'natural speaking performance',
        environment: 'Scene location from screenplay',
        durationSeconds,
        sceneAction: `${beat.speaker} delivers this exact line — do not skip or paraphrase`,
        keyProps,
      });
    } else {
      const keyProps = collectVisibleStoryProps(undefined, beat.text);
      shots.push({
        sceneOrder: beat.sceneOrder,
        shotOrder: shotOrder++,
        shotType: keyProps.length ? 'insert' : 'medium_shot',
        speakerName: null,
        dialogue: '',
        charactersVisible: [],
        cameraDirection: keyProps.length
          ? `Insert/close-up clearly showing ${keyProps.join(' and ')}`
          : 'Cinematic coverage of the action only (no speech)',
        facialExpression: 'matching the moment',
        bodyLanguage: keyProps.length
          ? `hands/object focus on ${keyProps.join(' and ')}`
          : 'perform the described action',
        environment: 'Scene location from screenplay',
        durationSeconds: clampDuration(3.5, maxClip),
        sceneAction: beat.text.slice(0, 280),
        keyProps,
      });
    }
  }

  // Scale shot durations to roughly match episode target without dropping dialogue.
  const target = options?.targetDurationSeconds ?? 0;
  if (target > 0 && shots.length) {
    const total = shots.reduce((sum, s) => sum + s.durationSeconds, 0);
    if (total > target * 1.15) {
      const scale = target / total;
      for (const shot of shots) {
        shot.durationSeconds = clampDuration(
          Math.max(shot.dialogue?.trim() ? 2.5 : 2, shot.durationSeconds * scale),
          maxClip,
        );
      }
    }
  }

  return shots;
}

/** @deprecated Prefer screenplayToClipShots — kept for tests/legacy beat helpers. */
export function splitScreenplayIntoBeats(script: string): string[] {
  return screenplayToClipShots(script).map((shot) =>
    shot.dialogue?.trim()
      ? `${shot.speakerName || 'Character'}: ${shot.dialogue.trim()}`
      : shot.sceneAction || `Shot ${shot.shotOrder}`,
  );
}

/**
 * Expand a single screenplay shot into one or more ≤maxClip segments.
 * Keeps dialogue on the first segment when splitting so sentences are not fabricated mid-cut.
 */
export function splitShotIntoClipSegments(
  shot: ClipPlanShotInput,
  maxClipDurationSeconds: number,
): Array<ClipPlanShotInput & { segmentIndex: number; segmentCount: number }> {
  const maxClip = Math.min(
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    Math.max(1, maxClipDurationSeconds),
  );
  const total = clampDuration(shot.durationSeconds, 120);
  if (total <= maxClip) {
    return [{ ...shot, durationSeconds: total, segmentIndex: 0, segmentCount: 1 }];
  }

  const segments: Array<ClipPlanShotInput & { segmentIndex: number; segmentCount: number }> = [];
  let remaining = total;
  let index = 0;
  const count = Math.ceil(total / maxClip);
  while (remaining > 0) {
    const duration = Math.min(maxClip, remaining);
    segments.push({
      ...shot,
      durationSeconds: duration,
      dialogue: index === 0 ? shot.dialogue : '',
      segmentIndex: index,
      segmentCount: count,
      cameraDirection:
        index === 0
          ? shot.cameraDirection
          : `Continue previous framing. ${shot.cameraDirection ?? ''}`.trim(),
    });
    remaining = Number((remaining - duration).toFixed(2));
    index += 1;
  }
  return segments;
}

function describeShotAction(
  shot: ClipPlanShotInput & { segmentIndex?: number; segmentCount?: number },
): string {
  const dialogueBit = shot.dialogue?.trim()
    ? `${shot.speakerName || 'Character'} says: "${shot.dialogue.trim()}"`
    : null;
  const performance = [shot.facialExpression, shot.bodyLanguage].filter(Boolean).join('; ');
  const sceneBit = shot.sceneAction?.trim() || null;
  const props = collectVisibleStoryProps(
    shot.keyProps,
    shot.dialogue,
    shot.sceneAction,
    shot.bodyLanguage,
  );
  const propsBit = props.length
    ? `SHOW ON CAMERA: ${props.join(', ')} (clearly visible, not off-screen)`
    : null;
  const segmentBit =
    shot.segmentCount && shot.segmentCount > 1
      ? `(part ${(shot.segmentIndex ?? 0) + 1}/${shot.segmentCount})`
      : null;
  const bits = [dialogueBit, performance || null, sceneBit, propsBit, segmentBit].filter(Boolean);
  return bits.join(' — ') || `Shot ${shot.shotOrder} visual beat`;
}

function buildClipPrompt(input: {
  episode: ClipPlanEpisodeContext;
  clip: Omit<
    PlannedEpisodeClip,
    'prompt' | 'previousClipSummary' | 'nextClipHint' | 'continuity'
  > & {
    previousClipSummary: string | null;
    nextClipHint: string | null;
  };
  identityBlocks: string[];
  clipOrdinal: number;
  clipTotal: number;
}): string {
  const style =
    input.episode.visualStyle?.trim() ||
    'Stylized cinematic 3D cartoon animation (Pixar/DreamWorks-like). Expressive cartoon faces, consistent character models, NOT photorealistic.';

  const aspectRatio = input.episode.aspectRatio?.trim() || '9:16';

  return [
    'CLIP INFORMATION',
    `Episode: ${input.episode.episodeNumber} — ${input.episode.episodeTitle}`,
    `Clip ${input.clipOrdinal} of ${input.clipTotal} (ONLY this beat — do not re-enact other clips)`,
    `Scene: ${input.clip.sceneOrder}`,
    `Shots: ${input.clip.shotOrders.join(', ')}`,
    `Timeline: ${input.clip.startOffsetSeconds}s → ${input.clip.endOffsetSeconds}s`,
    `Duration: ${input.clip.durationSeconds}s`,
    '',
    'FRAME (mandatory)',
    `Aspect ratio MUST be ${aspectRatio} vertical (portrait). Fill the entire frame edge-to-edge.`,
    'Do NOT generate landscape 16:9. Do NOT leave empty side bars or letterboxing.',
    'Phone-vertical composition: subject centered, headroom for dialogue close-ups.',
    '',
    'VISUAL STYLE',
    style,
    'Keep the SAME art style, lighting quality, and camera language as the rest of this episode.',
    '',
    'CHARACTERS (lock identity across every clip)',
    input.identityBlocks.length
      ? input.identityBlocks.join('\n\n')
      : input.clip.characters.join(', ') || 'As described in the screenplay.',
    'CRITICAL: Reuse the EXACT same faces, ages, skin tones, hairstyles, and outfits as the canonical identity above.',
    'Do not redesign, beautify, age-shift, or swap ethnicity/gender between clips.',
    '',
    'LOCATION',
    input.clip.location || input.clip.environment,
    '',
    'PROPS / KEY OBJECTS (mandatory when listed)',
    input.clip.keyProps.length
      ? [
          `These objects MUST be clearly visible in frame: ${input.clip.keyProps.join(', ')}.`,
          'Show hands holding/using them, or a readable close-up/insert. Do not leave them off-screen.',
          'If a phone or message matters, show the device and a readable screen/gesture — not empty hands.',
          'If a ring/gift/letter matters, show the object itself in this clip.',
        ].join('\n')
      : 'No plot-critical props listed for this clip — keep hands/set dressing natural to the action.',
    '',
    'ACTION (this clip only)',
    input.clip.action,
    '',
    'CAMERA',
    input.clip.camera,
    '',
    'DIALOGUE (speak only these lines in this clip)',
    input.clip.dialogue.trim()
      ? input.clip.dialogue.trim()
      : '(No spoken dialogue in this clip — natural ambient performance only.)',
    '',
    'AUDIO',
    'Natural dialogue with lip-synced speech when dialogue is present.',
    input.clip.audioDirection || 'Environmental sounds appropriate to the location.',
    '',
    'CONTINUITY',
    input.clip.previousClipSummary
      ? `Already happened (do NOT repeat): ${input.clip.previousClipSummary}`
      : 'Opening clip of this sequence.',
    input.clip.nextClipHint
      ? `Comes next (do NOT jump ahead): ${input.clip.nextClipHint}`
      : 'Hold a natural end pose for assembly.',
    '',
    'RESTRICTIONS',
    'Film ONLY the ACTION and DIALOGUE for this clip.',
    'Do not restart the episode or replay earlier beats.',
    'Do not compress the whole episode into this clip.',
    'No unrelated characters.',
    'No unexpected costume or identity redesign.',
    'Do not omit listed props — phones, rings, letters, gifts, and similar story objects must appear when named.',
    'No unnecessary narration voice-over.',
    'No subtitles unless explicitly requested.',
    `No 16:9 / landscape framing — ${aspectRatio} only.`,
  ].join('\n');
}

/**
 * Build an ordered Grok Lite clip plan from screenplay shots.
 * Packs consecutive short shots in the same scene when they fit under maxClip.
 */
export function buildEpisodeClipPlan(input: {
  episode: ClipPlanEpisodeContext;
  shots: ClipPlanShotInput[];
  characters?: Array<Parameters<typeof seriesCharacterToIdentityProfile>[0]>;
}): EpisodeClipPlanResult {
  const maxClip = Math.min(
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    Math.max(
      1,
      input.episode.maxClipDurationSeconds ?? SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    ),
  );
  const notes: string[] = [];
  const pricePerSecondUsd = input.episode.pricePerSecondUsd ?? 0.03;

  const ordered = [...input.shots].sort(
    (a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder,
  );

  if (ordered.length === 0) {
    const synthesized = screenplayToClipShots(
      input.episode.episodeScript?.trim() || input.episode.episodeSummary?.trim() || '',
      {
        targetDurationSeconds: input.episode.targetDurationSeconds,
        maxClipDurationSeconds: maxClip,
      },
    );
    if (synthesized.length > 0) {
      notes.push(
        `No EpisodeShot rows — synthesized ${synthesized.length} speaking/action shots from the screenplay so Grok gets real DIALOGUE lines.`,
      );
      const fromScript = buildEpisodeClipPlan({
        ...input,
        shots: synthesized,
      });
      return {
        ...fromScript,
        notes: [...notes, ...fromScript.notes],
      };
    }

    // Last resort: duration slots with unique synopsis fragments (no speech).
    const slots = planClipDurationsForEpisode(input.episode.targetDurationSeconds, maxClip);
    notes.push(
      'WARNING: no dialogue could be parsed from the screenplay; using silent visual beats only.',
    );
    const summary = input.episode.episodeSummary?.trim() || 'Continue the episode story';
    const clips: PlannedEpisodeClip[] = slots.map((slot, index, all) => {
      const action = `Silent visual beat ${index + 1} of ${all.length} (${slot.startOffsetSeconds}s–${slot.endOffsetSeconds}s). ${summary} — show ONLY the portion for this time range; do not speak lines.`;
      const base = {
        clipIndex: index,
        sceneOrder: 1,
        shotOrders: [index + 1],
        sourceShotIds: [] as string[],
        durationSeconds: slot.durationSeconds,
        startOffsetSeconds: slot.startOffsetSeconds,
        endOffsetSeconds: slot.endOffsetSeconds,
        characters: [] as string[],
        speakerName: null as string | null,
        dialogue: '',
        location: 'Episode setting',
        environment: 'As established for this beat only',
        camera: 'Cinematic coverage matching this beat',
        action,
        keyProps: collectVisibleStoryProps(undefined, summary, action),
        audioDirection: 'Natural scene audio',
        musicDirection: '',
        previousClipSummary:
          index > 0 ? `Previous silent beat ${index} already filmed` : null,
        nextClipHint:
          index < all.length - 1 ? `Next silent beat ${index + 2}` : null,
      };
      return {
        ...base,
        prompt: buildClipPrompt({
          episode: input.episode,
          clip: base,
          identityBlocks: [],
          clipOrdinal: index + 1,
          clipTotal: all.length,
        }),
        continuity: {
          location: base.location,
          clothingNotes: 'Use approved character default clothing',
          charactersPresent: [],
          actionsCompleted: [],
          actionsContinuing: [],
        },
      };
    });
    // Unique actions for assertClipPlanValid
    for (let i = 0; i < clips.length; i++) {
      clips[i]!.action = `${clips[i]!.action} [slot ${i + 1}]`;
    }
    const totalDurationSeconds = Number(
      clips.reduce((sum, c) => sum + c.durationSeconds, 0).toFixed(2),
    );
    const plan = {
      clips,
      totalDurationSeconds,
      maxClipDurationSeconds: maxClip,
      clipCount: clips.length,
      estimatedCostUsd: Number((totalDurationSeconds * pricePerSecondUsd).toFixed(6)),
      pricePerSecondUsd,
      notes,
    };
    assertClipPlanValid(plan);
    return plan;
  }

  const expanded = ordered.flatMap((shot) => splitShotIntoClipSegments(shot, maxClip));
  notes.push(
    `Packed ${ordered.length} screenplay shot(s) into clip segments with max ${maxClip}s.`,
  );

  type PackGroup = {
    segments: typeof expanded;
  };
  const groups: PackGroup[] = [];
  for (const segment of expanded) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push({ segments: [segment] });
      continue;
    }
    const lastSeg = last.segments[last.segments.length - 1]!;
    const combined =
      last.segments.reduce((sum, s) => sum + s.durationSeconds, 0) + segment.durationSeconds;
    const sameScene = lastSeg.sceneOrder === segment.sceneOrder;
    const packedDialogueWords = last.segments.reduce(
      (sum, s) => sum + countWords(s.dialogue ?? ''),
      0,
    );
    const nextDialogueWords = countWords(segment.dialogue ?? '');
    const wouldOverloadSpeech =
      nextDialogueWords > 0 &&
      packedDialogueWords + nextDialogueWords > MAX_SPOKEN_WORDS_PER_CLIP;
    const canPack =
      sameScene &&
      combined <= maxClip + 0.05 &&
      !wouldOverloadSpeech &&
      // One speaking line per pack when both sides have dialogue — Grok can't lip-sync a monologue pile-up.
      !(segment.dialogue?.trim() && last.segments.some((s) => s.dialogue?.trim()));

    if (canPack) {
      last.segments.push(segment);
    } else {
      groups.push({ segments: [segment] });
    }
  }

  const identityByName = new Map<string, SeriesCharacterIdentityProfile>();
  for (const character of input.characters ?? []) {
    const profile = seriesCharacterToIdentityProfile(character);
    identityByName.set(character.name.toLowerCase(), profile);
    identityByName.set(character.name, profile);
  }

  let offset = 0;
  const draftClips: Array<
    Omit<PlannedEpisodeClip, 'prompt' | 'continuity'> & {
      continuity?: PlannedEpisodeClip['continuity'];
    }
  > = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const duration = Number(
      group.segments.reduce((sum, s) => sum + s.durationSeconds, 0).toFixed(2),
    );
    const characters = Array.from(
      new Set(group.segments.flatMap((s) => asNames(s.charactersVisible))),
    );
    const dialogue = group.segments
      .filter((s) => s.dialogue?.trim())
      .map((s) => `${s.speakerName || 'Character'}: ${s.dialogue!.trim()}`)
      .join('\n');

    const first = group.segments[0]!;
    const action = group.segments.map((s) => describeShotAction(s)).join(' → ');
    const keyProps = collectVisibleStoryProps(
      group.segments.flatMap((s) => s.keyProps ?? []),
      ...group.segments.flatMap((s) => [s.dialogue, s.sceneAction, s.bodyLanguage, s.cameraDirection]),
      action,
    );

    const camera = group.segments
      .map((s) =>
        [s.shotType, s.cameraDirection, s.cameraMovement].filter(Boolean).join(' / '),
      )
      .join(' → ');

    draftClips.push({
      clipIndex: i,
      sceneOrder: first.sceneOrder,
      shotOrders: group.segments.map((s) => s.shotOrder),
      sourceShotIds: group.segments.map((s) => s.id).filter(Boolean) as string[],
      durationSeconds: clampDuration(duration, maxClip),
      startOffsetSeconds: offset,
      endOffsetSeconds: offset + clampDuration(duration, maxClip),
      characters,
      speakerName: first.speakerName ?? null,
      dialogue,
      location: first.location || first.environment || 'Scene location',
      environment: first.environment || first.location || 'Scene environment',
      camera: camera || 'Cinematic coverage',
      action: action || `Distinct beat for shots ${group.segments.map((s) => s.shotOrder).join(',')}`,
      keyProps,
      audioDirection: group.segments.map((s) => s.ambientSound).filter(Boolean).join('; '),
      musicDirection: group.segments.map((s) => s.musicDirection).filter(Boolean).join('; '),
      previousClipSummary: null,
      nextClipHint: null,
    });
    offset += clampDuration(duration, maxClip);
  }

  // Always lock the full approved cast into every clip prompt so faces don't drift.
  const rosterNames = (input.characters ?? []).map((c) => c.name);

  const clips: PlannedEpisodeClip[] = draftClips.map((clip, index, all) => {
    const previous = index > 0 ? all[index - 1] : null;
    const next = index < all.length - 1 ? all[index + 1] : null;
    const previousClipSummary = previous
      ? `Scene ${previous.sceneOrder}, shots ${previous.shotOrders.join(',')}: ${previous.action}${
          previous.dialogue ? ` | Dialogue: ${previous.dialogue}` : ''
        }`
      : null;
    const nextClipHint = next
      ? `Scene ${next.sceneOrder}, shots ${next.shotOrders.join(',')}: ${next.action}`
      : null;

    const namesForIdentity = Array.from(
      new Set(
        [...rosterNames, ...clip.characters, clip.speakerName]
          .map((n) => (n ?? '').trim())
          .filter(Boolean),
      ),
    );
    const identityBlocks = namesForIdentity
      .map((name) => identityByName.get(name) ?? identityByName.get(name.toLowerCase()))
      .filter(Boolean)
      .map((profile) => formatCharacterIdentityForClipPrompt(profile!));

    const withContext = {
      ...clip,
      characters: namesForIdentity.length ? namesForIdentity : clip.characters,
      previousClipSummary,
      nextClipHint,
    };

    return {
      ...withContext,
      prompt: buildClipPrompt({
        episode: input.episode,
        clip: withContext,
        identityBlocks,
        clipOrdinal: index + 1,
        clipTotal: all.length,
      }),
      continuity: {
        location: clip.location,
        clothingNotes: 'Use approved default clothing unless screenplay documents a change',
        charactersPresent: clip.characters,
        actionsCompleted: previous ? [previous.action] : [],
        actionsContinuing: next ? [next.action] : [],
      },
    };
  });

  const totalDurationSeconds = Number(
    clips.reduce((sum, clip) => sum + clip.durationSeconds, 0).toFixed(2),
  );

  if (clips.some((clip) => clip.durationSeconds > maxClip)) {
    notes.push('ERROR: planner produced a clip over the max duration — clamp failed.');
  } else {
    notes.push(`All ${clips.length} clips are within ${maxClip}s.`);
  }

  const plan = {
    clips,
    totalDurationSeconds,
    maxClipDurationSeconds: maxClip,
    clipCount: clips.length,
    estimatedCostUsd: Number((totalDurationSeconds * pricePerSecondUsd).toFixed(6)),
    pricePerSecondUsd,
    notes,
  };
  assertClipPlanValid(plan);
  return plan;
}

export function assertClipPlanValid(plan: EpisodeClipPlanResult): void {
  for (const clip of plan.clips) {
    if (clip.durationSeconds > plan.maxClipDurationSeconds) {
      throw new Error(
        `Clip ${clip.clipIndex} duration ${clip.durationSeconds}s exceeds max ${plan.maxClipDurationSeconds}s`,
      );
    }
    if (clip.durationSeconds <= 0) {
      throw new Error(`Clip ${clip.clipIndex} has invalid duration`);
    }
    if (!clip.prompt.trim()) {
      throw new Error(`Clip ${clip.clipIndex} is missing a prompt`);
    }
    if (!clip.action.trim()) {
      throw new Error(`Clip ${clip.clipIndex} is missing a distinct action beat`);
    }
  }

  // Guard the exact failure mode: two packs with the same synopsis/action → identical Grok videos.
  for (let i = 0; i < plan.clips.length; i++) {
    for (let j = i + 1; j < plan.clips.length; j++) {
      const a = plan.clips[i]!;
      const b = plan.clips[j]!;
      const actionA = normalizeForCompare(a.action);
      const actionB = normalizeForCompare(b.action);
      if (actionA && actionA === actionB) {
        throw new Error(
          `Clips ${a.clipIndex + 1} and ${b.clipIndex + 1} share the same action beat — refusing duplicate Grok prompts`,
        );
      }
      const dialogueA = normalizeForCompare(a.dialogue);
      const dialogueB = normalizeForCompare(b.dialogue);
      if (dialogueA && dialogueB && dialogueA === dialogueB && dialogueA.length > 12) {
        throw new Error(
          `Clips ${a.clipIndex + 1} and ${b.clipIndex + 1} share the same dialogue — refusing duplicate Grok prompts`,
        );
      }
    }
  }
}
