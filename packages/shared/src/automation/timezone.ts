/**
 * Timezone helpers using Intl (no hard-coded server timezone).
 * Safe across DST transitions when formatting with the target IANA zone.
 */

export function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[get('weekday')] ?? 0,
  };
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Invalid time value: ${hhmm}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Convert a local wall-clock datetime in `timeZone` to a UTC Date.
 * Iteratively corrects for DST offset differences.
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  hhmm: string,
  timeZone: string,
): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(guess, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = desired - asUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function isWeekendInTimeZone(date: Date, timeZone: string): boolean {
  const { weekday } = getZonedParts(date, timeZone);
  return weekday === 0 || weekday === 6;
}

export function isPublishingDayAllowed(input: {
  date: Date;
  timeZone: string;
  preferredPublishingDays: number[];
  includeWeekends: boolean;
}): boolean {
  const { weekday } = getZonedParts(input.date, input.timeZone);
  if (!input.includeWeekends && (weekday === 0 || weekday === 6)) {
    return false;
  }
  if (!input.preferredPublishingDays?.length) {
    return true;
  }
  return input.preferredPublishingDays.includes(weekday);
}
