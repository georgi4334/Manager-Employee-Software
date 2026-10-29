import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../../../test/helpers.js';
import { HolidayFeedClient } from './holiday-feed.client.js';
import type { FeedHoliday } from './holiday-feed.parse.js';
import { PublicHolidaysService } from './public-holidays.service.js';

class FakeFeed extends HolidayFeedClient {
  calls: string[] = [];
  failing = false;
  data = new Map<string, FeedHoliday[]>();
  fetchYear(country: string, year: number, language: string): Promise<FeedHoliday[]> {
    this.calls.push(`${country}|${year}|${language}`);
    if (this.failing) return Promise.reject(new Error('down'));
    return Promise.resolve(this.data.get(`${country}|${year}`) ?? []);
  }
}

const day = (date: string, name: string): FeedHoliday => ({ date, endDate: date, name });
const query = { from: '2026-10-01', to: '2026-12-31', language: 'en' as const };

function setup(enabled = true) {
  const feed = new FakeFeed();
  feed.data.set('BG|2026', [day('2026-11-01', 'National Awakening Day')]);
  feed.data.set('DE|2026', [
    day('2026-10-03', 'Day of German Unity'),
    day('2026-12-25', 'Christmas'),
  ]);
  feed.data.set('GB|2026', [day('2026-12-25', 'Christmas Day'), day('2026-01-01', 'New Year')]);
  const service = new PublicHolidaysService(
    feed,
    testEnv({ PUBLIC_HOLIDAYS_FEED: String(enabled) }),
  );
  return { feed, service };
}

describe('PublicHolidaysService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('merges the three countries inside the period, sorted by date then country', async () => {
    const { service } = setup();
    const { items } = await service.list(query);
    expect(items.map((h) => `${h.date} ${h.country} ${h.name}`)).toEqual([
      '2026-10-03 DE Day of German Unity',
      '2026-11-01 BG National Awakening Day',
      '2026-12-25 DE Christmas',
      '2026-12-25 GB Christmas Day',
    ]); // New Year (GB) is outside the period
    expect(items.every((h) => h.source === 'openholidays' && h.key === null)).toBe(true);
  });

  it('fetches each country and year once a day, and again after a day', async () => {
    const { service, feed } = setup();
    await service.list(query);
    await service.list(query);
    expect(feed.calls).toHaveLength(3);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await service.list(query);
    expect(feed.calls).toHaveLength(6);
  });

  it('keeps languages apart and fetches both years of a period over New Year', async () => {
    const { service, feed } = setup();
    await service.list({ from: '2026-12-20', to: '2027-01-05', language: 'de' });
    expect(feed.calls.sort()).toEqual([
      'BG|2026|de',
      'BG|2027|de',
      'DE|2026|de',
      'DE|2027|de',
      'GB|2026|de',
      'GB|2027|de',
    ]);
  });

  it('serves the last copy when the feed later fails', async () => {
    const { service, feed } = setup();
    await service.list(query);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    feed.failing = true;
    const { items } = await service.list(query);
    expect(items).toHaveLength(4);
    expect(items[0]?.source).toBe('openholidays');
  });

  it('falls back to offline holidays for Bulgaria and Germany, and nothing for England', async () => {
    const { service, feed } = setup();
    feed.failing = true;
    const { items } = await service.list({ from: '2026-12-24', to: '2026-12-26', language: 'en' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((h) => h.source === 'builtin' && h.name === null && h.key)).toBe(true);
    expect(new Set(items.map((h) => h.country))).toEqual(new Set(['BG', 'DE']));
  });

  it('never calls the feed when it is switched off', async () => {
    const { service, feed } = setup(false);
    const { items } = await service.list({ from: '2026-12-24', to: '2026-12-26', language: 'en' });
    expect(feed.calls).toEqual([]);
    expect(items.every((h) => h.source === 'builtin')).toBe(true);
  });

  it('includes a multi-day holiday that starts before the period', async () => {
    const { service, feed } = setup();
    feed.data.set('DE|2026', [{ date: '2026-09-29', endDate: '2026-10-02', name: 'Long break' }]);
    const { items } = await service.list(query);
    expect(items.map((h) => h.name)).toContain('Long break');
  });
});
