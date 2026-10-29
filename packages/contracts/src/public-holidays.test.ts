import { describe, expect, it } from 'vitest';
import { PUBLIC_HOLIDAY_COUNTRIES, publicHolidayQuerySchema } from './public-holidays.js';

describe('publicHolidayQuerySchema', () => {
  it('accepts a range and defaults the language to English', () => {
    const parsed = publicHolidayQuerySchema.parse({ from: '2026-10-01', to: '2026-10-31' });
    expect(parsed.language).toBe('en');
  });

  it('accepts a range of at most 93 days and refuses longer ones', () => {
    expect(
      publicHolidayQuerySchema.safeParse({ from: '2026-01-01', to: '2026-04-03' }).success,
    ).toBe(true); // 93 days
    const long = publicHolidayQuerySchema.safeParse({ from: '2026-01-01', to: '2026-04-04' });
    expect(long.success).toBe(false);
  });

  it('refuses an end before the start, bad dates and unknown languages', () => {
    for (const bad of [
      { from: '2026-10-05', to: '2026-10-01' },
      { from: '2026-13-01', to: '2026-13-02' },
      { from: '2026-10-01', to: '2026-10-02', language: 'fr' },
      { from: '2026-10-01' },
    ]) {
      expect(publicHolidayQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('lists exactly Bulgaria, Germany and England (GB)', () => {
    expect([...PUBLIC_HOLIDAY_COUNTRIES]).toEqual(['BG', 'DE', 'GB']);
  });
});
