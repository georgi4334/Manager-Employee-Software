import { z } from 'zod';
import { daysBetween } from './dates.js';
import { dateOnlySchema } from './employees.js';
import { BUILT_IN_HOLIDAY_KEYS } from './holidays.js';

/** Countries of the calendar's public-holiday layer (ADR 0035). `GB` means England. */
export const PUBLIC_HOLIDAY_COUNTRIES = ['BG', 'DE', 'GB'] as const;
export type PublicHolidayCountry = (typeof PUBLIC_HOLIDAY_COUNTRIES)[number];

export const PUBLIC_HOLIDAY_LANGUAGES = ['en', 'de', 'bg'] as const;
export type PublicHolidayLanguage = (typeof PUBLIC_HOLIDAY_LANGUAGES)[number];

export const MAX_PUBLIC_HOLIDAY_RANGE_DAYS = 93;

export const publicHolidayQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    language: z.enum(PUBLIC_HOLIDAY_LANGUAGES).default('en'),
  })
  .refine((value) => value.to >= value.from, { path: ['to'], error: 'end_before_start' })
  .refine((value) => daysBetween(value.from, value.to) + 1 <= MAX_PUBLIC_HOLIDAY_RANGE_DAYS, {
    path: ['to'],
    error: 'too_long',
  });
export type PublicHolidayQuery = z.infer<typeof publicHolidayQuerySchema>;

export const publicHolidaySchema = z.object({
  date: dateOnlySchema,
  /** Equal to `date` for a single day. */
  endDate: dateOnlySchema,
  country: z.enum(PUBLIC_HOLIDAY_COUNTRIES),
  /** The feed's name in the requested language; `null` for offline data, which carries a key instead. */
  name: z.string().nullable(),
  key: z.enum(BUILT_IN_HOLIDAY_KEYS).nullable(),
  source: z.enum(['openholidays', 'builtin']),
});
export type PublicHoliday = z.infer<typeof publicHolidaySchema>;

export const publicHolidayListSchema = z.object({ items: z.array(publicHolidaySchema) });
export type PublicHolidayList = z.infer<typeof publicHolidayListSchema>;
