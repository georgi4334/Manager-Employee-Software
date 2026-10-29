import { describe, expect, it } from 'vitest';
import { openDay } from './week-day.js';

const days = [
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
].map((date) => ({ date, minutes: 0 }));
const entryOn = (workDate: string) => ({ workDate }) as never;

describe('openDay', () => {
  it('keeps a selected day that is in the week', () => {
    expect(openDay({ days, entries: [] }, '2026-10-29', '2026-10-27')).toBe('2026-10-27');
  });

  it('opens on today when it is in the week', () => {
    expect(openDay({ days, entries: [] }, '2026-10-29', null)).toBe('2026-10-29');
  });

  it('opens on the first day with entries in another week', () => {
    expect(openDay({ days, entries: [entryOn('2026-10-28')] }, '2026-12-01', null)).toBe(
      '2026-10-28',
    );
  });

  it('falls back to the first day, and ignores a selection from another week', () => {
    expect(openDay({ days, entries: [] }, '2026-12-01', null)).toBe('2026-10-26');
    expect(openDay({ days, entries: [] }, '2026-12-01', '2026-12-02')).toBe('2026-10-26');
  });

  it('copes with a week without days', () => {
    expect(openDay({ days: [], entries: [] }, '2026-12-01', null)).toBe('2026-12-01');
  });
});
