import { describe, expect, it } from 'vitest';
import { OpenHolidaysClient } from '../src/modules/calendar/holiday-feed.client.js';

/**
 * The real OpenHolidays feed (docs/adr/0035-public-holidays-feed.md). Skipped unless HOLIDAY_FEED_LIVE=1:
 * normal runs never reach the network. `.github/workflows/holiday-feed.yml` runs it weekly and on demand,
 * so a change in the feed's format or in what counts as nationwide shows up before people see a wrong calendar.
 */
describe.skipIf(!process.env.HOLIDAY_FEED_LIVE)('OpenHolidays feed (live)', () => {
  const client = new OpenHolidaysClient();
  const year = new Date().getUTCFullYear();
  const dates = (items: { date: string }[]) => items.map((h) => h.date);

  it('Bulgaria: nationwide holidays with Bulgarian names', async () => {
    const items = await client.fetchYear('BG', year, 'bg');
    expect(dates(items)).toContain(`${year}-03-03`); // Liberation Day
    expect(dates(items)).toContain(`${year}-05-24`);
    expect(items.every((h) => h.name.trim() !== '')).toBe(true);
  });

  it('Germany: nationwide only, so no state holidays such as Epiphany', async () => {
    const items = await client.fetchYear('DE', year, 'de');
    expect(dates(items)).toContain(`${year}-10-03`); // German Unity Day
    expect(dates(items)).toContain(`${year}-12-25`);
    expect(dates(items)).not.toContain(`${year}-01-06`); // Epiphany: some states only
  });

  it('England: the whole kingdom plus England, never Scotland only', async () => {
    const items = await client.fetchYear('GB', year, 'en');
    expect(dates(items)).toContain(`${year}-12-25`);
    expect(dates(items)).not.toContain(`${year}-11-30`); // St Andrew's Day: Scotland
    expect(dates(items)).not.toContain(`${year}-01-02`); // 2 January: Scotland
    expect(items.length).toBeGreaterThanOrEqual(6);
  });

  it('every item is a well-formed day range', async () => {
    for (const country of ['BG', 'DE', 'GB'] as const) {
      for (const h of await client.fetchYear(country, year, 'en')) {
        expect(h.date, country).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(h.endDate >= h.date, `${country} ${h.date}`).toBe(true);
      }
    }
  });
});
