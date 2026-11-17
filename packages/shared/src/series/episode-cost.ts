/**
 * Episode cost planning for dialogue-driven Series Studio.
 * Prices are fal/Gemini public list rates used for estimates (not invoices).
 */

export const SERIES_COST_MODE = ['quality', 'balanced', 'economy'] as const;
export type SeriesCostMode = (typeof SERIES_COST_MODE)[number];

export const SERIES_SHOT_PRODUCTION_METHOD = [
  'kling_avatar_lip_sync',
  'ffmpeg_still_motion',
  'hailuo_motion',
  'reuse_existing',
] as const;
export type SeriesShotProductionMethod = (typeof SERIES_SHOT_PRODUCTION_METHOD)[number];

export const SERIES_PROVIDER_LIST_PRICES_USD = {
  fluxDevPerMegapixel: 0.025,
  klingAvatarV2StandardPerSecond: 0.0562,
  hailuo768pPerSecond: 0.045,
  geminiTtsAudioOutputPerMillionTokens: 6.0,
  geminiTtsAudioTokensPerSecond: 25,
} as const;

export type CostAwareShotInput = {
  shotType: string;
  dialogue: string;
  durationSeconds: number;
  requiresLipSync: boolean;
  speaker: string;
};

export type CostAwareShotDecision = CostAwareShotInput & {
  productionMethod: SeriesShotProductionMethod;
  billableLipSyncSeconds: number;
  estimatedLipSyncUsd: number;
  estimatedMotionUsd: number;
};

export type EpisodeCostEstimate = {
  mode: SeriesCostMode;
  speakingShotCount: number;
  reactionOrEnvShotCount: number;
  lipSyncSeconds: number;
  estimatedLipSyncUsd: number;
  estimatedPortraitUsd: number;
  estimatedTtsUsd: number;
  estimatedHailuoUsd: number;
  estimatedTotalUsd: number;
  notes: string[];
};

export function resolveSeriesCostMode(raw: unknown): SeriesCostMode {
  if (raw === 'quality' || raw === 'economy' || raw === 'balanced') return raw;
  return 'balanced';
}

/** Target speaking (lip-sync) budget as a fraction of episode duration. */
export function lipSyncBudgetFraction(mode: SeriesCostMode): number {
  switch (mode) {
    case 'quality':
      return 0.55;
    case 'economy':
      return 0.28;
    case 'balanced':
    default:
      return 0.4;
  }
}

export function estimateKlingAvatarCostUsd(durationSeconds: number): number {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  return Number((seconds * SERIES_PROVIDER_LIST_PRICES_USD.klingAvatarV2StandardPerSecond).toFixed(6));
}

export function estimateFluxPortraitCostUsd(imageCount: number, megapixels = 1): number {
  const mp = Math.max(1, Math.ceil(megapixels));
  return Number(
    (Math.max(0, imageCount) * mp * SERIES_PROVIDER_LIST_PRICES_USD.fluxDevPerMegapixel).toFixed(6),
  );
}

export function estimateDialogueTtsCostUsd(audioSeconds: number): number {
  const tokens =
    Math.max(0, audioSeconds) * SERIES_PROVIDER_LIST_PRICES_USD.geminiTtsAudioTokensPerSecond;
  return Number(
    (
      (tokens / 1_000_000) *
      SERIES_PROVIDER_LIST_PRICES_USD.geminiTtsAudioOutputPerMillionTokens
    ).toFixed(6),
  );
}

export function classifyShotProductionMethod(
  shot: CostAwareShotInput,
  mode: SeriesCostMode = 'balanced',
): SeriesShotProductionMethod {
  const dialogue = shot.dialogue.trim();
  if (dialogue && shot.requiresLipSync !== false) {
    return 'kling_avatar_lip_sync';
  }
  if (shot.shotType === 'reaction' || shot.shotType === 'insert' || shot.shotType === 'wide') {
    return 'ffmpeg_still_motion';
  }
  if (mode === 'quality' && !dialogue) {
    // Optional paid motion only in quality mode for non-speaking coverage.
    return 'ffmpeg_still_motion';
  }
  return 'ffmpeg_still_motion';
}

export function planShotCosts(
  shots: CostAwareShotInput[],
  mode: SeriesCostMode = 'balanced',
): CostAwareShotDecision[] {
  return shots.map((shot) => {
    const productionMethod = classifyShotProductionMethod(shot, mode);
    const billableLipSyncSeconds =
      productionMethod === 'kling_avatar_lip_sync' ? Math.max(0, shot.durationSeconds) : 0;
    return {
      ...shot,
      productionMethod,
      billableLipSyncSeconds,
      estimatedLipSyncUsd: estimateKlingAvatarCostUsd(billableLipSyncSeconds),
      estimatedMotionUsd:
        productionMethod === 'hailuo_motion'
          ? Number(
              (
                shot.durationSeconds * SERIES_PROVIDER_LIST_PRICES_USD.hailuo768pPerSecond
              ).toFixed(6),
            )
          : 0,
    };
  });
}

/**
 * Soft-trim speaking duration toward the lip-sync budget without dropping speakers.
 * Only shortens durations; does not delete lines.
 */
export function applyLipSyncDurationBudget<T extends CostAwareShotInput>(
  shots: T[],
  episodeTargetSeconds: number,
  mode: SeriesCostMode = 'balanced',
): T[] {
  const budget = Math.max(8, episodeTargetSeconds * lipSyncBudgetFraction(mode));
  const speakingIdx = shots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.dialogue.trim() && s.requiresLipSync !== false);
  const current = speakingIdx.reduce((n, { s }) => n + s.durationSeconds, 0);
  if (current <= budget || speakingIdx.length === 0) return shots;

  const scale = budget / current;
  const next = shots.map((s) => ({ ...s }));
  for (const { i, s } of speakingIdx) {
    const scaled = Math.max(1.5, Number((s.durationSeconds * scale).toFixed(2)));
    next[i] = { ...next[i]!, durationSeconds: scaled };
  }
  return next;
}

export function estimateDialogueEpisodeCost(input: {
  mode?: SeriesCostMode;
  episodeTargetSeconds: number;
  shots: CostAwareShotInput[];
  newPortraitCount?: number;
  portraitMegapixels?: number;
}): EpisodeCostEstimate {
  const mode = input.mode ?? 'balanced';
  const planned = planShotCosts(input.shots, mode);
  const lipSyncSeconds = planned.reduce((n, s) => n + s.billableLipSyncSeconds, 0);
  const estimatedLipSyncUsd = planned.reduce((n, s) => n + s.estimatedLipSyncUsd, 0);
  const estimatedHailuoUsd = planned.reduce((n, s) => n + s.estimatedMotionUsd, 0);
  const estimatedPortraitUsd = estimateFluxPortraitCostUsd(
    input.newPortraitCount ?? 0,
    input.portraitMegapixels ?? 1,
  );
  const estimatedTtsUsd = estimateDialogueTtsCostUsd(lipSyncSeconds);
  const speakingShotCount = planned.filter((s) => s.billableLipSyncSeconds > 0).length;
  const reactionOrEnvShotCount = planned.length - speakingShotCount;
  const notes: string[] = [
    `Cost mode=${mode}; lip-sync budget ~${Math.round(lipSyncBudgetFraction(mode) * 100)}% of episode.`,
    'Reaction / environment coverage should use FFmpeg still-motion, not Hailuo, in dialogue mode.',
    'Character portraits should be generated once per movie and reused.',
  ];
  if (estimatedHailuoUsd > 0) {
    notes.push('Hailuo motion present in plan — unexpected for default dialogue-driven mode.');
  }
  return {
    mode,
    speakingShotCount,
    reactionOrEnvShotCount,
    lipSyncSeconds: Number(lipSyncSeconds.toFixed(3)),
    estimatedLipSyncUsd: Number(estimatedLipSyncUsd.toFixed(6)),
    estimatedPortraitUsd,
    estimatedTtsUsd,
    estimatedHailuoUsd: Number(estimatedHailuoUsd.toFixed(6)),
    estimatedTotalUsd: Number(
      (estimatedLipSyncUsd + estimatedPortraitUsd + estimatedTtsUsd + estimatedHailuoUsd).toFixed(6),
    ),
    notes,
  };
}

/** Deduplicate ProviderUsage-style rows where submit+complete both carry full cost. */
export function dedupeProviderUsageCostUsd(
  rows: Array<{ provider: string; requestType: string; estimatedCost: number }>,
): number {
  let total = 0;
  for (const row of rows) {
    if (
      row.provider === 'hailuo' &&
      (row.requestType === 'image_to_video_complete' ||
        row.requestType === 'image_to_video_poll')
    ) {
      // Completions are lifecycle markers; cost was recorded at submit.
      continue;
    }
    total += Number(row.estimatedCost) || 0;
  }
  return Number(total.toFixed(6));
}
