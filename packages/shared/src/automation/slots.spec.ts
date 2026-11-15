import { resolveDailySlot, subtractMinutesFromHm } from './slots';

describe('daily slots', () => {
  it('maps slot 0 to morning 08:00 and slot 1 to evening 19:00', () => {
    expect(resolveDailySlot(0).kind).toBe('morning');
    expect(resolveDailySlot(0).publishTime).toBe('08:00');
    expect(resolveDailySlot(1).kind).toBe('evening');
    expect(resolveDailySlot(1).publishTime).toBe('19:00');
    expect(resolveDailySlot(2).kind).toBe('morning');
  });

  it('subtracts generate lead time safely', () => {
    expect(subtractMinutesFromHm('08:00', 180)).toBe('05:00');
    expect(subtractMinutesFromHm('19:00', 180)).toBe('16:00');
    expect(subtractMinutesFromHm('01:00', 180)).toBe('00:00');
  });
});
