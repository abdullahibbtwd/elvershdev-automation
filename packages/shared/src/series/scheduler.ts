import {
  formatDateInTimeZone,
  getZonedParts,
  parseTimeToMinutes,
  zonedDateTimeToUtc,
} from '../automation/timezone';

export const SERIES_PRODUCTION_START_MODES = [
  'IMMEDIATE',
  'NEXT_WINDOW',
  'CUSTOM',
  'MANUAL',
] as const;

export type SeriesProductionStartModeName =
  (typeof SERIES_PRODUCTION_START_MODES)[number];

/** True when local wall-clock in `timeZone` has reached today's publishTime (same minute). */
export function isLanePublishDue(now: Date, timeZone: string, publishTime: string): boolean {
  const parts = getZonedParts(now, timeZone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const target = parseTimeToMinutes(publishTime);
  return nowMinutes === target;
}

/** Next UTC instant for the lane publish time (today if still upcoming, else next local day). */
export function computeNextPublishAt(
  now: Date,
  timeZone: string,
  publishTime: string,
): Date {
  const today = formatDateInTimeZone(now, timeZone);
  const todayAt = zonedDateTimeToUtc(today, publishTime, timeZone);
  if (todayAt.getTime() > now.getTime()) {
    return todayAt;
  }

  // Advance one local calendar day using noon anchor to avoid DST edge ambiguity.
  const local = getZonedParts(now, timeZone);
  const noonUtc = Date.UTC(local.year, local.month - 1, local.day, 12, 0, 0);
  const nextLocalDate = formatDateInTimeZone(new Date(noonUtc + 36 * 60 * 60 * 1000), timeZone);
  return zonedDateTimeToUtc(nextLocalDate, publishTime, timeZone);
}

/**
 * Wall-clock HH:MM for production start = publishTime minus lead minutes
 * (wraps across midnight).
 */
export function computeProductionClockTime(
  publishTime: string,
  leadTimeMinutes: number,
  preferredProductionTime?: string | null,
): string {
  if (preferredProductionTime && /^\d{1,2}:\d{2}$/.test(preferredProductionTime.trim())) {
    const mins = parseTimeToMinutes(preferredProductionTime.trim());
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const publishMins = parseTimeToMinutes(publishTime);
  const lead = Math.max(0, Math.floor(leadTimeMinutes));
  const startMins = ((publishMins - lead) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(startMins / 60);
  const m = startMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Next UTC instant when the production window opens for the upcoming publish. */
export function computeNextProductionAt(
  now: Date,
  timeZone: string,
  publishTime: string,
  leadTimeMinutes: number,
  preferredProductionTime?: string | null,
): Date {
  const nextPublish = computeNextPublishAt(now, timeZone, publishTime);
  const clock = computeProductionClockTime(
    publishTime,
    leadTimeMinutes,
    preferredProductionTime,
  );
  const publishLocalDate = formatDateInTimeZone(nextPublish, timeZone);
  let productionAt = zonedDateTimeToUtc(publishLocalDate, clock, timeZone);
  // If production clock is after publish on the same calendar day (lead wrap),
  // production belongs on the previous local day relative to that publish.
  if (productionAt.getTime() > nextPublish.getTime()) {
    const parts = getZonedParts(nextPublish, timeZone);
    const noonUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0);
    const prevLocalDate = formatDateInTimeZone(
      new Date(noonUtc - 12 * 60 * 60 * 1000),
      timeZone,
    );
    productionAt = zonedDateTimeToUtc(prevLocalDate, clock, timeZone);
  }
  if (productionAt.getTime() > now.getTime()) {
    return productionAt;
  }
  // Window already open for this publish — return the open time (may be in the past).
  return productionAt;
}

export type ProductionEligibilityInput = {
  now: Date;
  timeZone: string;
  publishTime: string;
  leadTimeMinutes: number;
  preferredProductionTime?: string | null;
  productionStartMode: SeriesProductionStartModeName;
  customProductionStartAt?: Date | string | null;
};

/**
 * Whether media/script auto-work may start for a lane.
 * MANUAL never; CUSTOM after timestamp; IMMEDIATE always;
 * NEXT_WINDOW once the production clock for the upcoming publish has been reached.
 */
export function isLaneProductionEligible(input: ProductionEligibilityInput): boolean {
  const mode = input.productionStartMode;
  if (mode === 'MANUAL') return false;
  if (mode === 'IMMEDIATE') return true;
  if (mode === 'CUSTOM') {
    if (!input.customProductionStartAt) return false;
    const at =
      input.customProductionStartAt instanceof Date
        ? input.customProductionStartAt
        : new Date(input.customProductionStartAt);
    return Number.isFinite(at.getTime()) && input.now.getTime() >= at.getTime();
  }
  // NEXT_WINDOW
  const nextPublish = computeNextPublishAt(
    input.now,
    input.timeZone,
    input.publishTime,
  );
  const clock = computeProductionClockTime(
    input.publishTime,
    input.leadTimeMinutes,
    input.preferredProductionTime,
  );
  const publishLocalDate = formatDateInTimeZone(nextPublish, input.timeZone);
  let windowOpen = zonedDateTimeToUtc(publishLocalDate, clock, input.timeZone);
  if (windowOpen.getTime() > nextPublish.getTime()) {
    const parts = getZonedParts(nextPublish, input.timeZone);
    const noonUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0);
    const prevLocalDate = formatDateInTimeZone(
      new Date(noonUtc - 12 * 60 * 60 * 1000),
      input.timeZone,
    );
    windowOpen = zonedDateTimeToUtc(prevLocalDate, clock, input.timeZone);
  }
  return input.now.getTime() >= windowOpen.getTime();
}

export function seriesScheduleIdempotencyKey(laneId: string, episodeId: string): string {
  return `series-sched:${laneId}:${episodeId}`;
}

export function seriesScheduleAttemptKey(
  laneId: string,
  episodeId: string,
  scheduledAt: Date,
): string {
  return `series-sched:${laneId}:${episodeId}:${scheduledAt.toISOString().slice(0, 16)}`;
}

export function seriesReplacementIdempotencyKey(
  laneId: string,
  sourceSeriesId: string,
): string {
  return `series-replace:${laneId}:${sourceSeriesId}`;
}

/**
 * BullMQ custom job IDs cannot contain `:`.
 * Use this for every Queue.add({ jobId }) value.
 */
export function bullMqJobId(...parts: Array<string | number>): string {
  return parts
    .map((part) => String(part).replace(/:/g, '-'))
    .filter((part) => part.length > 0)
    .join('-');
}

export function seriesPublishJobId(scheduleId: string): string {
  return bullMqJobId('series-pub', scheduleId);
}

export function seriesMaintenanceJobId(mode: string, minuteKey: string): string {
  return bullMqJobId('series-maint', mode, minuteKey);
}

export function utcMinuteKey(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

/** Whether replacement planning should start for this lane progress. */
export function shouldTriggerReplacement(input: {
  lastPublishedEpisodeNumber: number;
  replacementTriggerEpisode: number;
  plannedEpisodeCount: number;
}): boolean {
  if (input.replacementTriggerEpisode < 1) return false;
  if (input.lastPublishedEpisodeNumber < input.replacementTriggerEpisode) return false;
  return input.replacementTriggerEpisode <= input.plannedEpisodeCount;
}

/** Master production switch must be on AND the stage switch must be on. */
export function isSeriesStageAutoEnabled(
  masterAutomaticEpisodeProduction: boolean,
  stageEnabled: boolean,
): boolean {
  return masterAutomaticEpisodeProduction && stageEnabled;
}
