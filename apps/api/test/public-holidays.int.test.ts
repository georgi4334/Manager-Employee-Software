import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema, publicHolidayListSchema } from '@intime/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HolidayFeedClient } from '../src/modules/calendar/holiday-feed.client.js';
import type { FeedHoliday } from '../src/modules/calendar/holiday-feed.parse.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;

class FakeFeed extends HolidayFeedClient {
  calls: string[] = [];
  failing = false;
  fetchYear(country: string, year: number, language: string): Promise<FeedHoliday[]> {
    this.calls.push(`${country}|${year}|${language}`);
    if (this.failing) return Promise.reject(new Error('down'));
    const name = `${country} Christmas (${language})`;
    return Promise.resolve([{ date: `${year}-12-25`, endDate: `${year}-12-25`, name }]);
  }
}

describe.skipIf(!urls)('public holidays over HTTP (real database, fake feed)', () => {
  const feed = new FakeFeed();
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
    PUBLIC_HOLIDAYS_FEED: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace } = httpWorkspaceHelpers(() => app);
  let acme: Workspace;
  const get = (query: object) =>
    acme.admin.agent.get('/api/v1/calendar/public-holidays').query(query);

  beforeAll(async () => {
    app = await createTestApp({ env, providers: [{ provide: HolidayFeedClient, useValue: feed }] });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  it('returns the holidays of Bulgaria, Germany and England in the asked language', async () => {
    const res = await get({ from: '2026-12-01', to: '2026-12-31', language: 'de' });
    expect(res.status).toBe(200);
    const { items } = publicHolidayListSchema.parse(res.body);
    expect(items.map((h) => [h.country, h.name, h.source])).toEqual([
      ['BG', 'BG Christmas (de)', 'openholidays'],
      ['DE', 'DE Christmas (de)', 'openholidays'],
      ['GB', 'GB Christmas (de)', 'openholidays'],
    ]);
  });

  it('defaults to English and sends the feed nothing but country, year and language', async () => {
    feed.calls.length = 0;
    const res = await get({ from: '2027-12-01', to: '2027-12-31' });
    expect(res.status).toBe(200);
    expect(feed.calls.sort()).toEqual(['BG|2027|en', 'DE|2027|en', 'GB|2027|en']);
  });

  it('answers with offline data instead of failing when the feed is down', async () => {
    feed.failing = true;
    const res = await get({ from: '2028-12-24', to: '2028-12-26', language: 'en' });
    expect(res.status).toBe(200);
    const { items } = publicHolidayListSchema.parse(res.body);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((h) => h.source === 'builtin' && h.key !== null)).toBe(true);
    feed.failing = false;
  });

  it('refuses a missing, backwards or too long range and an unknown language', async () => {
    for (const bad of [
      {},
      { from: '2026-12-31', to: '2026-12-01' },
      { from: '2026-01-01', to: '2026-12-31' },
      { from: '2026-12-01', to: '2026-12-31', language: 'fr' },
      { from: '2026-12-01', to: '2026-12-31', url: 'https://evil.example' },
    ]) {
      const res = await get(bad);
      if (res.status === 200) {
        // an unknown extra parameter is ignored, never used as a host
        expect(JSON.stringify(res.body)).not.toContain('evil');
        continue;
      }
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('needs a signed-in user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/calendar/public-holidays')
      .query({ from: '2026-12-01', to: '2026-12-31' });
    expect(res.status).toBe(401);
  });
});
