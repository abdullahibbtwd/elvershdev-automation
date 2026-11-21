/**
 * Three independent duration levels for Series Studio / cinematic production.
 *
 * 1. Complete story / movie duration — total runtime of the whole work
 * 2. Episode duration — runtime of one episode (default 60s; preserved for existing projects)
 * 3. Clip duration — max per Grok Lite generation request (≤15s)
 *
 * Never treat movie duration as episode or clip duration.
 */

export const SERIES_DURATION_DEFAULTS = {
  /** Individual episode default — do not silently change existing projects. */
  episodeDurationSeconds: 60,
  /** Legacy default episode count when story duration is not configured. */
  plannedEpisodeCount: 10,
  /** Grok Imagine Video 1.5 Lite hard cap. */
  maxClipDurationSeconds: 15,
  /** Soft product presets (seconds). */
  storyDurationPresets: [300, 600, 900, 1200, 1800] as const,
  episodeDurationPresets: [60, 120, 300, 600] as const,
  clipDurationPresets: [6, 8, 10, 12, 15] as const,
} as const;

export const SERIES_PRODUCTION_FORMATS = ['episodic', 'standalone'] as const;
export type SeriesProductionFormat = (typeof SERIES_PRODUCTION_FORMATS)[number];

export type ResolveSeriesDurationPlanInput = {
  productionFormat?: SeriesProductionFormat | null;
  /** Total movie/story runtime in seconds. */
  storyDurationSeconds?: number | null;
  /** Target runtime per episode (except possibly the last). Default 60. */
  episodeDurationSeconds?: number | null;
  /** Explicit episode count. Used when story duration is absent (legacy). */
  plannedEpisodeCount?: number | null;
  /** Max seconds per generated video clip (Grok Lite ≤15). */
  maxClipDurationSeconds?: number | null;
};

export type SeriesEpisodeDurationSlot = {
  episodeNumber: number;
  targetDurationSeconds: number;
  isFinalEpisode: boolean;
  /** Shorter than the configured episode duration to fit the story total. */
  truncatedToFitStory: boolean;
};

export type SeriesClipDurationSlot = {
  clipIndex: number;
  durationSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export type SeriesDurationPlan = {
  productionFormat: SeriesProductionFormat;
  storyDurationSeconds: number;
  episodeDurationSeconds: number;
  maxClipDurationSeconds: number;
  plannedEpisodeCount: number;
  episodes: SeriesEpisodeDurationSlot[];
  /** Estimated clip count if every episode were filled with max-length clips. */
  estimatedClipCount: number;
  /** Estimated billable video seconds across all clips. */
  estimatedVideoSeconds: number;
  derivation:
    | 'story_and_episode'
    | 'episode_count_and_episode'
    | 'standalone_story'
    | 'defaults';
  notes: string[];
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Resolve the three duration levels into a concrete episode schedule.
 *
 * Precedence:
 * - standalone → 1 episode whose duration equals story duration (or episode duration)
 * - storyDuration + episodeDuration → episode count ≈ ceil(story / episode); last may be shorter
 * - plannedEpisodeCount + episodeDuration (legacy) → story = count * episode
 * - defaults → 10 × 60s
 */
export function resolveSeriesDurationPlan(
  input: ResolveSeriesDurationPlanInput = {},
): SeriesDurationPlan {
  const notes: string[] = [];
  const maxClipDurationSeconds = clampInt(
    input.maxClipDurationSeconds,
    1,
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
  );
  const episodeDurationSeconds = clampInt(
    input.episodeDurationSeconds,
    15,
    1800,
    SERIES_DURATION_DEFAULTS.episodeDurationSeconds,
  );

  const format: SeriesProductionFormat =
    input.productionFormat === 'standalone' ? 'standalone' : 'episodic';

  if (format === 'standalone') {
    const storyDurationSeconds = clampInt(
      input.storyDurationSeconds ?? input.episodeDurationSeconds,
      15,
      3600,
      episodeDurationSeconds,
    );
    const episodes: SeriesEpisodeDurationSlot[] = [
      {
        episodeNumber: 1,
        targetDurationSeconds: storyDurationSeconds,
        isFinalEpisode: true,
        truncatedToFitStory: false,
      },
    ];
    const clips = planClipDurationsForEpisode(storyDurationSeconds, maxClipDurationSeconds);
    notes.push(
      'Standalone movie: one production unit equal to the complete story duration (not split into episodic parts).',
    );
    return {
      productionFormat: 'standalone',
      storyDurationSeconds,
      episodeDurationSeconds: storyDurationSeconds,
      maxClipDurationSeconds,
      plannedEpisodeCount: 1,
      episodes,
      estimatedClipCount: clips.length,
      estimatedVideoSeconds: storyDurationSeconds,
      derivation: 'standalone_story',
      notes,
    };
  }

  const hasStory = input.storyDurationSeconds != null && Number(input.storyDurationSeconds) > 0;
  const hasCount = input.plannedEpisodeCount != null && Number(input.plannedEpisodeCount) > 0;
  const hasExplicitEpisode =
    input.episodeDurationSeconds != null && Number(input.episodeDurationSeconds) > 0;

  let storyDurationSeconds: number;
  let plannedEpisodeCount: number;
  let derivation: SeriesDurationPlan['derivation'];
  let resolvedEpisodeDuration = episodeDurationSeconds;

  // Both story + episode count: fit N episodes into the movie runtime
  // (e.g. 60s story + 2 episodes → 2×30s, even if episode default is still 60).
  if (hasStory && hasCount) {
    storyDurationSeconds = clampInt(input.storyDurationSeconds, 15, 3600, 600);
    plannedEpisodeCount = clampInt(input.plannedEpisodeCount, 1, 120, 10);
    const countFromEpisode = Math.max(
      1,
      Math.ceil(storyDurationSeconds / resolvedEpisodeDuration),
    );
    if (countFromEpisode !== plannedEpisodeCount) {
      resolvedEpisodeDuration = Math.max(
        15,
        Math.ceil(storyDurationSeconds / plannedEpisodeCount),
      );
      notes.push(
        `Episode duration adjusted to ${resolvedEpisodeDuration}s so ${plannedEpisodeCount} episodes fit the ${storyDurationSeconds}s complete story.`,
      );
    } else if (!hasExplicitEpisode) {
      resolvedEpisodeDuration = Math.max(
        15,
        Math.ceil(storyDurationSeconds / plannedEpisodeCount),
      );
    }
    derivation = 'story_and_episode';
    notes.push(
      `Episodic plan from story (${storyDurationSeconds}s) + episode count (${plannedEpisodeCount}) → ~${resolvedEpisodeDuration}s per episode.`,
    );
  } else if (hasStory) {
    storyDurationSeconds = clampInt(input.storyDurationSeconds, 15, 3600, 600);
    plannedEpisodeCount = Math.max(1, Math.ceil(storyDurationSeconds / resolvedEpisodeDuration));
    derivation = 'story_and_episode';
    notes.push(
      `Episodic plan derived from complete story duration (${storyDurationSeconds}s) ÷ episode duration (${resolvedEpisodeDuration}s) → ${plannedEpisodeCount} episode(s).`,
    );
  } else if (hasCount) {
    plannedEpisodeCount = clampInt(input.plannedEpisodeCount, 1, 120, 10);
    storyDurationSeconds = plannedEpisodeCount * resolvedEpisodeDuration;
    derivation = 'episode_count_and_episode';
    notes.push(
      `Legacy/count-based plan: ${plannedEpisodeCount} × ${resolvedEpisodeDuration}s ≈ ${storyDurationSeconds}s complete story duration.`,
    );
  } else {
    plannedEpisodeCount = SERIES_DURATION_DEFAULTS.plannedEpisodeCount;
    storyDurationSeconds = plannedEpisodeCount * resolvedEpisodeDuration;
    derivation = 'defaults';
    notes.push(
      `Defaults preserved: ${plannedEpisodeCount} episodes × ${resolvedEpisodeDuration}s (existing 60s episode behaviour).`,
    );
  }

  const episodes: SeriesEpisodeDurationSlot[] = [];
  let allocated = 0;
  for (let i = 1; i <= plannedEpisodeCount; i++) {
    const remaining = Math.max(0, storyDurationSeconds - allocated);
    const isFinal = i === plannedEpisodeCount;
    const target = isFinal
      ? remaining
      : Math.min(resolvedEpisodeDuration, remaining);
    const duration = Math.max(1, target);
    episodes.push({
      episodeNumber: i,
      targetDurationSeconds: duration,
      isFinalEpisode: isFinal,
      truncatedToFitStory: duration < resolvedEpisodeDuration,
    });
    allocated += duration;
  }

  // Safety: if ceil math overshot empty trailing slots, drop zero/empty (shouldn't happen with max(1,...))
  const nonEmpty = episodes.filter((e) => e.targetDurationSeconds > 0);
  const estimatedClipCount = nonEmpty.reduce(
    (sum, ep) => sum + planClipDurationsForEpisode(ep.targetDurationSeconds, maxClipDurationSeconds).length,
    0,
  );

  return {
    productionFormat: 'episodic',
    storyDurationSeconds,
    episodeDurationSeconds: resolvedEpisodeDuration,
    maxClipDurationSeconds,
    plannedEpisodeCount: nonEmpty.length,
    episodes: nonEmpty.map((ep, index) => ({
      ...ep,
      episodeNumber: index + 1,
      isFinalEpisode: index === nonEmpty.length - 1,
    })),
    estimatedClipCount,
    estimatedVideoSeconds: storyDurationSeconds,
    derivation,
    notes,
  };
}

/**
 * Split an episode into clip durations that never exceed maxClipDurationSeconds.
 * Prefers full-length clips; the final clip may be shorter.
 */
export function planClipDurationsForEpisode(
  episodeDurationSeconds: number,
  maxClipDurationSeconds: number = SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
): SeriesClipDurationSlot[] {
  const episode = Math.max(1, Math.round(episodeDurationSeconds));
  const maxClip = clampInt(
    maxClipDurationSeconds,
    1,
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
    SERIES_DURATION_DEFAULTS.maxClipDurationSeconds,
  );

  const clips: SeriesClipDurationSlot[] = [];
  let offset = 0;
  let index = 0;
  while (offset < episode) {
    const remaining = episode - offset;
    const duration = Math.min(maxClip, remaining);
    clips.push({
      clipIndex: index,
      durationSeconds: duration,
      startOffsetSeconds: offset,
      endOffsetSeconds: offset + duration,
    });
    offset += duration;
    index += 1;
  }
  return clips;
}

/** Rough Grok Lite video cost from clip plan (configurable per-second rate). */
export function estimateGrokLiteCostFromDurationPlan(
  plan: SeriesDurationPlan,
  pricePerSecondUsd = 0.03,
): number {
  return Number((plan.estimatedVideoSeconds * pricePerSecondUsd).toFixed(6));
}

export function summarizeDurationPlan(plan: SeriesDurationPlan): string {
  return [
    `Format: ${plan.productionFormat}`,
    `Complete story: ${plan.storyDurationSeconds}s`,
    `Episode target: ${plan.episodeDurationSeconds}s`,
    `Episodes: ${plan.plannedEpisodeCount}`,
    `Max clip: ${plan.maxClipDurationSeconds}s`,
    `Est. clips: ${plan.estimatedClipCount}`,
    `Derivation: ${plan.derivation}`,
  ].join(' · ');
}
