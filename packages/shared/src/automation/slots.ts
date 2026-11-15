/**
 * Daily publishing slots for cinematic storytelling automation.
 * Slot 0 = Morning motivation; Slot 1 = Evening emotional.
 */

export type DailySlotKind = 'morning' | 'evening';

export interface DailySlotProfile {
  kind: DailySlotKind;
  /** Local wall-clock publish time HH:mm */
  publishTime: string;
  /** Minutes before publish when generation should start */
  generateLeadMinutes: number;
  label: string;
  preferredCategories: string[];
  preferredThemes: string[];
  toneHint: string;
  briefInstructions: string;
}

export const DEFAULT_DAILY_SLOTS: DailySlotProfile[] = [
  {
    kind: 'morning',
    publishTime: '08:00',
    generateLeadMinutes: 180,
    label: 'Morning · Motivation',
    preferredCategories: ['Personal growth', 'Life lessons', 'Motivation'],
    preferredThemes: ['ambition', 'discipline', 'courage', 'failure and growth', 'patience'],
    toneHint: 'Inspirational, determined, clear — speak to ambition and resilience',
    briefInstructions: [
      'MORNING SLOT: inspirational story about ambition, discipline, courage, failure, or personal growth.',
      'Hook in first 2–3 seconds with a curiosity spike (e.g. "He was one day away from giving up...").',
      'Include a turning point and a practical lesson. Vary endings — do not always say "never give up".',
      'End narration with a soft follow CTA inviting people who want more stories that keep them going.',
    ].join(' '),
  },
  {
    kind: 'evening',
    publishTime: '19:00',
    generateLeadMinutes: 180,
    label: 'Evening · Emotional',
    preferredCategories: ['Human emotions', 'Kindness and humanity', 'Unexpected twists'],
    preferredThemes: ['kindness', 'family', 'sacrifice', 'loneliness', 'hope', 'unexpected life lessons'],
    toneHint: 'Warm, emotional, reflective — speak to the heart without melodrama',
    briefInstructions: [
      'EVENING SLOT: emotional story about kindness, family, sacrifice, loneliness, hope, or an unexpected life lesson.',
      'Hook in first 2–3 seconds (e.g. "Every night, an old man left his porch light on...").',
      'Build curiosity, deliver an emotional or surprising turn, then a meaningful lesson.',
      'End with a soft follow CTA for more stories with meaning. Prefer shareable emotional payoff over lectures.',
    ].join(' '),
  },
];

export function resolveDailySlot(
  slotIndex: number,
  slots: DailySlotProfile[] = DEFAULT_DAILY_SLOTS,
): DailySlotProfile {
  const list = slots.length ? slots : DEFAULT_DAILY_SLOTS;
  return list[((slotIndex % list.length) + list.length) % list.length]!;
}

/** Subtract minutes from HH:mm, clamping within the same day (00:00–23:59). */
export function subtractMinutesFromHm(hm: string, minutes: number): string {
  const [hRaw, mRaw] = hm.split(':');
  const h = Number.parseInt(hRaw ?? '0', 10);
  const m = Number.parseInt(mRaw ?? '0', 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '06:00';
  const total = Math.max(0, h * 60 + m - Math.max(0, minutes));
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
