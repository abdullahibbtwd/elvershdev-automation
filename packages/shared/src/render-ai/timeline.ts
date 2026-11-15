import type { RenderSettings, RenderSettingsInput, SubtitleStyle } from './schemas';
import { audioMixSettingsSchema, renderSettingsSchema, subtitleStyleSchema } from './schemas';

export type TransitionType = 'none' | 'fade' | 'crossfade';

export interface TimelineSceneInput {
  sceneId: string;
  sequence: number;
  sceneNumber: number;
  narrationText: string;
  narrationDurationSeconds: number;
  motionDurationSeconds: number | null;
  hasMotionClip: boolean;
  hasImage: boolean;
  selectedMotionGenerationId: string | null;
  selectedVisualId: string | null;
  selectedAudioGenerationId: string | null;
  motionStorageKey: string | null;
  imageStorageKey: string | null;
  audioStorageKey: string | null;
  soundEffectStorageKey?: string | null;
  transitionIn?: TransitionType;
  transitionOut?: TransitionType;
}

export interface SubtitleCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  sceneId: string;
  sequence: number;
}

export interface PlannedTimelineScene {
  sceneId: string;
  sequence: number;
  sceneNumber: number;
  startTime: number;
  endTime: number;
  duration: number;
  visualSource: 'motion' | 'image';
  motionDurationSeconds: number | null;
  narrationDurationSeconds: number;
  /** When narration exceeds motion, extend with still-image continuation */
  extendWithImageSeconds: number;
  /** When motion exceeds narration, trim or keep motion without padding narration */
  trimMotionToSeconds: number | null;
  selectedMotionGenerationId: string | null;
  selectedVisualId: string | null;
  selectedAudioGenerationId: string | null;
  motionStorageKey: string | null;
  imageStorageKey: string | null;
  audioStorageKey: string | null;
  soundEffectStorageKey: string | null;
  transitionIn: TransitionType;
  transitionOut: TransitionType;
  narrationText: string;
  subtitleCues: SubtitleCue[];
}

export interface RenderTimeline {
  totalDurationSeconds: number;
  sceneCount: number;
  scenes: PlannedTimelineScene[];
  subtitleCues: SubtitleCue[];
  settings: RenderSettings;
  timingStrategy: 'narration_driven';
  timingNotes: string[];
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Split narration into readable subtitle segments.
 * Timing is sentence/phrase-level approximation proportional to character length
 * within the narration audio window — not word-level forced alignment.
 */
export function splitNarrationIntoSubtitleSegments(
  text: string,
  startSeconds: number,
  durationSeconds: number,
  style: SubtitleStyle,
  sceneId: string,
  sequence: number,
  startIndex: number,
): SubtitleCue[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned || durationSeconds <= 0) return [];

  const maxChars = style.maxCharsPerLine * style.maxLines;
  const sentences = cleaned
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences.length ? sentences : [cleaned]) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    const words = sentence.split(' ');
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  const cues: SubtitleCue[] = [];
  let cursor = startSeconds;
  let remaining = durationSeconds;

  chunks.forEach((chunk, idx) => {
    const isLast = idx === chunks.length - 1;
    const share = chunk.length / totalChars;
    const raw = isLast ? remaining : Math.max(0.6, durationSeconds * share);
    const cueDuration = roundTime(Math.min(remaining, raw));
    const end = roundTime(cursor + cueDuration);
    cues.push({
      index: startIndex + idx,
      startSeconds: roundTime(cursor),
      endSeconds: end,
      text: chunk,
      sceneId,
      sequence,
    });
    remaining = roundTime(Math.max(0, remaining - cueDuration));
    cursor = end;
  });

  return cues;
}

export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function buildSrt(cues: SubtitleCue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.index}\n${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}\n${cue.text}\n`,
    )
    .join('\n');
}

/** Convert #RRGGBB to ASS &HAABBGGRR */
export function hexToAssColor(hex: string, alpha = 0): string {
  const cleaned = hex.replace('#', '').trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned.padStart(6, '0').slice(0, 6);
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export function buildAss(cues: SubtitleCue[], style: SubtitleStyle, playResX: number, playResY: number): string {
  const alignmentMap = { bottom: 2, center: 5, top: 8 } as const;
  const primary = hexToAssColor(style.primaryColor, 0);
  const outline = hexToAssColor(style.outlineColor, 0);
  const back = hexToAssColor('#000000', style.backgroundBox ? 1 - style.backgroundOpacity : 1);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font},${style.fontSize},${primary},${primary},${outline},${back},0,0,0,0,100,100,0,0,${style.backgroundBox ? 3 : 1},${style.outlineWidth},${style.shadow},${alignmentMap[style.alignment]},60,60,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = cues
    .map((cue) => {
      const start = formatAssTime(cue.startSeconds);
      const end = formatAssTime(cue.endSeconds);
      const text = cue.text.replace(/\n/g, '\\N').replace(/[{}]/g, '');
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    })
    .join('\n');

  return `${header}${events}\n`;
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function planRenderTimeline(
  scenes: TimelineSceneInput[],
  partialSettings?: RenderSettingsInput,
): RenderTimeline {
  const settings = renderSettingsSchema.parse(partialSettings ?? {});
  const audioMix = audioMixSettingsSchema.parse(settings.audioMix ?? {});
  const subtitleStyle = subtitleStyleSchema.parse(settings.subtitleStyle ?? {});
  const ordered = [...scenes].sort((a, b) => a.sequence - b.sequence);
  const timingNotes: string[] = [];
  const planned: PlannedTimelineScene[] = [];
  let cursor = 0;
  let subtitleIndex = 1;

  for (let i = 0; i < ordered.length; i += 1) {
    const scene = ordered[i];
    if (!scene.hasImage && !scene.hasMotionClip) {
      throw new Error(`Scene ${scene.sceneNumber} is missing both motion clip and image`);
    }
    if (!scene.selectedAudioGenerationId || !scene.audioStorageKey) {
      throw new Error(`Scene ${scene.sceneNumber} is missing selected narration audio`);
    }

    const narrationDuration = Math.max(0.1, scene.narrationDurationSeconds);
    const motionDuration = scene.hasMotionClip
      ? Math.max(0.1, scene.motionDurationSeconds ?? narrationDuration)
      : null;

    let duration = narrationDuration + settings.scenePaddingSeconds;
    let extendWithImageSeconds = 0;
    let trimMotionToSeconds: number | null = null;
    let visualSource: 'motion' | 'image' = scene.hasMotionClip ? 'motion' : 'image';

    if (visualSource === 'motion' && motionDuration != null) {
      if (narrationDuration > motionDuration) {
        extendWithImageSeconds = roundTime(narrationDuration - motionDuration + settings.scenePaddingSeconds);
        duration = roundTime(motionDuration + extendWithImageSeconds);
        timingNotes.push(
          `Scene ${scene.sceneNumber}: narration (${narrationDuration.toFixed(2)}s) exceeds motion (${motionDuration.toFixed(2)}s); extending with still-image continuation`,
        );
      } else {
        // Keep motion length matched to narration + padding; do not unnecessarily extend final video
        trimMotionToSeconds = roundTime(duration);
        timingNotes.push(
          `Scene ${scene.sceneNumber}: motion (${motionDuration.toFixed(2)}s) longer than narration; trimming visual to ${trimMotionToSeconds.toFixed(2)}s`,
        );
      }
    } else {
      visualSource = 'image';
      timingNotes.push(
        `Scene ${scene.sceneNumber}: no motion clip; using still-image Ken Burns fallback for ${duration.toFixed(2)}s`,
      );
    }

    const transitionIn: TransitionType =
      scene.transitionIn ?? (i === 0 ? 'fade' : settings.transitionDurationSeconds > 0 ? 'crossfade' : 'none');
    const transitionOut: TransitionType =
      scene.transitionOut ??
      (i === ordered.length - 1 ? 'fade' : settings.transitionDurationSeconds > 0 ? 'crossfade' : 'none');

    const startTime = roundTime(cursor);
    const endTime = roundTime(startTime + duration);
    const subtitleCues = settings.subtitleEnabled
      ? splitNarrationIntoSubtitleSegments(
          scene.narrationText,
          startTime,
          narrationDuration,
          subtitleStyle,
          scene.sceneId,
          scene.sequence,
          subtitleIndex,
        )
      : [];
    subtitleIndex += subtitleCues.length;

    planned.push({
      sceneId: scene.sceneId,
      sequence: scene.sequence,
      sceneNumber: scene.sceneNumber,
      startTime,
      endTime,
      duration,
      visualSource,
      motionDurationSeconds: motionDuration,
      narrationDurationSeconds: narrationDuration,
      extendWithImageSeconds,
      trimMotionToSeconds,
      selectedMotionGenerationId: scene.selectedMotionGenerationId,
      selectedVisualId: scene.selectedVisualId,
      selectedAudioGenerationId: scene.selectedAudioGenerationId,
      motionStorageKey: scene.motionStorageKey,
      imageStorageKey: scene.imageStorageKey,
      audioStorageKey: scene.audioStorageKey,
      soundEffectStorageKey: scene.soundEffectStorageKey ?? null,
      transitionIn,
      transitionOut,
      narrationText: scene.narrationText,
      subtitleCues,
    });

    cursor = roundTime(endTime + audioMix.sceneGapSeconds);
  }

  const subtitleCues = planned.flatMap((scene) => scene.subtitleCues);
  const last = planned[planned.length - 1];
  const totalDurationSeconds = last ? last.endTime : 0;

  return {
    totalDurationSeconds,
    sceneCount: planned.length,
    scenes: planned,
    subtitleCues,
    settings,
    timingStrategy: 'narration_driven',
    timingNotes,
  };
}
