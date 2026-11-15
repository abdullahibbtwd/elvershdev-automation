import {
  formatDateInTimeZone,
  getZonedParts,
  isPublishingDayAllowed,
  parseTimeToMinutes,
  zonedDateTimeToUtc,
} from '@ai-video/shared';

describe('automation timezone helpers', () => {
  it('formats dates in a configured timezone', () => {
    const date = new Date('2026-03-08T05:30:00.000Z'); // 00:30 NY / 14:30 Tokyo
    const ny = formatDateInTimeZone(date, 'America/New_York');
    const tokyo = formatDateInTimeZone(date, 'Asia/Tokyo');
    expect(ny).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tokyo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Same calendar instant can share the date; verify zoned hour differs
    expect(getZonedParts(date, 'America/New_York').hour).not.toEqual(
      getZonedParts(date, 'Asia/Tokyo').hour,
    );
  });

  it('converts zoned wall time to UTC stably across DST', () => {
    const winter = zonedDateTimeToUtc('2026-01-15', '10:00', 'America/New_York');
    const summer = zonedDateTimeToUtc('2026-07-15', '10:00', 'America/New_York');
    expect(getZonedParts(winter, 'America/New_York').hour).toBe(10);
    expect(getZonedParts(summer, 'America/New_York').hour).toBe(10);
    // EDT is UTC-4, EST is UTC-5 → summer local 10:00 is earlier in UTC absolute? 
    // Actually summer offset is -4 so 10:00 EDT = 14:00 UTC; winter 10:00 EST = 15:00 UTC
    expect(summer.getUTCHours()).toBe(14);
    expect(winter.getUTCHours()).toBe(15);
  });

  it('parses HH:mm and publishing day filters', () => {
    expect(parseTimeToMinutes('09:30')).toBe(9 * 60 + 30);
    const saturday = zonedDateTimeToUtc('2026-03-14', '12:00', 'UTC');
    expect(
      isPublishingDayAllowed({
        date: saturday,
        timeZone: 'UTC',
        preferredPublishingDays: [1, 2, 3, 4, 5],
        includeWeekends: false,
      }),
    ).toBe(false);
  });
});
