import { Injectable } from '@nestjs/common';
import type { PublicHolidayCountry, PublicHolidayLanguage } from '@intime/contracts';
import { parseOpenHolidays, type FeedHoliday } from './holiday-feed.parse.js';

/** The seam to the holiday feed: tests replace it, so no test reaches the network. */
export abstract class HolidayFeedClient {
  /** Holidays of one country in one calendar year; rejects when the feed cannot be read. */
  abstract fetchYear(
    country: PublicHolidayCountry,
    year: number,
    language: PublicHolidayLanguage,
  ): Promise<FeedHoliday[]>;
}

/** Fixed on purpose: a client can never choose the host (ADR 0035). */
export const PUBLIC_HOLIDAYS_BASE_URL = 'https://openholidaysapi.org';
const TIMEOUT_MS = 8_000;

@Injectable()
export class OpenHolidaysClient extends HolidayFeedClient {
  async fetchYear(
    country: PublicHolidayCountry,
    year: number,
    language: PublicHolidayLanguage,
  ): Promise<FeedHoliday[]> {
    const url = new URL('/PublicHolidays', PUBLIC_HOLIDAYS_BASE_URL);
    url.searchParams.set('countryIsoCode', country);
    url.searchParams.set('languageIsoCode', language.toUpperCase());
    url.searchParams.set('validFrom', `${year}-01-01`);
    url.searchParams.set('validTo', `${year}-12-31`);
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`holiday feed answered ${response.status}`);
    return parseOpenHolidays(await response.json(), country, language);
  }
}
