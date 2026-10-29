import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PUBLIC_HOLIDAY_COUNTRIES,
  builtInHolidays,
  type PublicHoliday,
  type PublicHolidayCountry,
  type PublicHolidayLanguage,
  type PublicHolidayList,
  type PublicHolidayQuery,
} from '@intime/contracts';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { HolidayFeedClient } from './holiday-feed.client.js';
import type { FeedHoliday } from './holiday-feed.parse.js';

const FRESH_MS = 24 * 60 * 60 * 1000;

interface Entry {
  at: number;
  items: FeedHoliday[];
}

/**
 * The calendar's public-holiday layer for Bulgaria, Germany and England (ADR 0035). A year of one country in
 * one language is fetched once and kept for a day; a failing feed serves the last copy, else the offline
 * holidays (Bulgaria, Germany), else nothing. Informational: leave counting never reads this.
 */
@Injectable()
export class PublicHolidaysService {
  private readonly logger = new Logger(PublicHolidaysService.name);
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<FeedHoliday[] | null>>();

  constructor(
    private readonly feed: HolidayFeedClient,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  async list(query: PublicHolidayQuery): Promise<PublicHolidayList> {
    const firstYear = Number(query.from.slice(0, 4));
    const lastYear = Number(query.to.slice(0, 4));
    const items: PublicHoliday[] = [];
    for (const country of PUBLIC_HOLIDAY_COUNTRIES) {
      for (let year = firstYear; year <= lastYear; year += 1) {
        for (const day of await this.year(country, year, query.language)) {
          if (day.endDate < query.from || day.date > query.to) continue;
          items.push(day);
        }
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
    return { items };
  }

  private async year(
    country: PublicHolidayCountry,
    year: number,
    language: PublicHolidayLanguage,
  ): Promise<PublicHoliday[]> {
    const key = `${country}|${year}|${language}`;
    const cached = this.cache.get(key);
    const fresh = cached && Date.now() - cached.at < FRESH_MS;
    let items = fresh ? cached.items : null;
    if (!items && this.env.PUBLIC_HOLIDAYS_FEED) {
      items = await this.load(key, country, year, language);
      if (!items && cached) items = cached.items; // stale beats nothing
    }
    if (items) {
      return items.map((h) => ({
        date: h.date,
        endDate: h.endDate,
        country,
        name: h.name,
        key: null,
        source: 'openholidays' as const,
      }));
    }
    return builtInHolidays(country, year).map((h) => ({
      date: h.date,
      endDate: h.date,
      country,
      name: null,
      key: h.key,
      source: 'builtin' as const,
    }));
  }

  /** One fetch at a time per key; a failure is logged without anything but the key and status class. */
  private load(
    key: string,
    country: PublicHolidayCountry,
    year: number,
    language: PublicHolidayLanguage,
  ): Promise<FeedHoliday[] | null> {
    const running = this.inflight.get(key);
    if (running) return running;
    const started = this.feed
      .fetchYear(country, year, language)
      .then((items) => {
        this.cache.set(key, { at: Date.now(), items });
        return items;
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `holiday feed failed for ${country} ${year}: ${error instanceof Error ? error.name : 'error'}`,
        );
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }
}
