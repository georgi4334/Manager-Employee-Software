import { describe, expect, it } from 'vitest';
import { parseOpenHolidays } from './holiday-feed.parse.js';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  startDate: '2026-12-25',
  endDate: '2026-12-25',
  type: 'Public',
  nationwide: true,
  name: [
    { language: 'EN', text: 'Christmas Day' },
    { language: 'DE', text: 'Weihnachten' },
  ],
  ...over,
});

describe('parseOpenHolidays', () => {
  it('keeps nationwide public holidays in the requested language', () => {
    expect(parseOpenHolidays([entry()], 'DE', 'de')).toEqual([
      { date: '2026-12-25', endDate: '2026-12-25', name: 'Weihnachten' },
    ]);
  });

  it('falls back to English, then to the first name', () => {
    expect(parseOpenHolidays([entry()], 'DE', 'bg')[0]?.name).toBe('Christmas Day');
    const only = entry({ name: [{ language: 'BG', text: 'Коледа' }] });
    expect(parseOpenHolidays([only], 'BG', 'de')[0]?.name).toBe('Коледа');
  });

  it('ignores school holidays, observances and regional days outside the country scope', () => {
    const list = [
      entry({ type: 'School' }),
      entry({ type: 'Observance' }),
      entry({ nationwide: false, subdivisions: [{ code: 'DE-BY' }] }),
    ];
    expect(parseOpenHolidays(list, 'DE', 'en')).toEqual([]);
  });

  it('takes England-only days for GB but not Scotland-only ones', () => {
    const england = entry({
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      nationwide: false,
      subdivisions: [{ code: 'GB-ENG' }, { code: 'GB-WLS' }],
      name: [{ language: 'EN', text: 'Easter Monday' }],
    });
    const scotland = entry({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      nationwide: false,
      subdivisions: [{ code: 'GB-SCT' }],
      name: [{ language: 'EN', text: 'Summer Bank Holiday' }],
    });
    expect(parseOpenHolidays([england, scotland], 'GB', 'en').map((h) => h.name)).toEqual([
      'Easter Monday',
    ]);
    expect(parseOpenHolidays([england], 'BG', 'en')).toEqual([]); // GB rule only for GB
  });

  it('accepts bank holidays and a missing type, and sorts by date', () => {
    const a = entry({ type: 'Bank', startDate: '2026-12-26', endDate: '2026-12-26' });
    const b = entry({ type: undefined });
    expect(parseOpenHolidays([a, b], 'GB', 'en').map((h) => h.date)).toEqual([
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('repairs an end before the start and drops duplicates', () => {
    const odd = entry({ endDate: '2026-12-01' });
    expect(parseOpenHolidays([odd, odd], 'DE', 'en')).toHaveLength(1);
    expect(parseOpenHolidays([odd], 'DE', 'en')[0]?.endDate).toBe('2026-12-25');
  });

  it('survives garbage: wrong shapes, bad dates, empty names, a non-array', () => {
    expect(parseOpenHolidays('nope', 'DE', 'en')).toEqual([]);
    expect(parseOpenHolidays(null, 'DE', 'en')).toEqual([]);
    expect(
      parseOpenHolidays(
        [
          null,
          42,
          { startDate: 'soon' },
          entry({ name: [] }),
          entry({ name: [{ language: 'EN', text: '   ' }] }),
        ],
        'DE',
        'en',
      ),
    ).toEqual([]);
  });

  it('keeps multi-day holidays as a range', () => {
    const range = entry({ startDate: '2026-12-24', endDate: '2026-12-26' });
    expect(parseOpenHolidays([range], 'DE', 'en')[0]).toMatchObject({
      date: '2026-12-24',
      endDate: '2026-12-26',
    });
  });
});
