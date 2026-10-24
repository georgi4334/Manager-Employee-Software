import { addDays, isWeekend, type DateString } from './dates.js';

/** Countries whose national public holidays are built in. Others get none until HR adds custom days. */
export const BUILT_IN_HOLIDAY_COUNTRIES = ['BG', 'DE'] as const;
export type BuiltInHolidayCountry = (typeof BUILT_IN_HOLIDAY_COUNTRIES)[number];

export const isBuiltInHolidayCountry = (value: unknown): value is BuiltInHolidayCountry =>
  typeof value === 'string' && (BUILT_IN_HOLIDAY_COUNTRIES as readonly string[]).includes(value);

/** Every key a built-in holiday can have; the web app has a translation for each (checked by tests). */
export const BUILT_IN_HOLIDAY_KEYS = [
  'BG.new_year',
  'BG.liberation_day',
  'BG.labour_day',
  'BG.st_george',
  'BG.culture_day',
  'BG.unification_day',
  'BG.independence_day',
  'BG.christmas_eve',
  'BG.christmas',
  'BG.christmas_second_day',
  'BG.good_friday',
  'BG.holy_saturday',
  'BG.easter_sunday',
  'BG.easter_monday',
  'BG.compensation_day',
  'DE.new_year',
  'DE.good_friday',
  'DE.easter_monday',
  'DE.labour_day',
  'DE.ascension_day',
  'DE.whit_monday',
  'DE.unity_day',
  'DE.christmas',
  'DE.christmas_second_day',
] as const;
export type BuiltInHolidayKey = (typeof BUILT_IN_HOLIDAY_KEYS)[number];

export const isBuiltInHolidayKey = (value: unknown): value is BuiltInHolidayKey =>
  typeof value === 'string' && (BUILT_IN_HOLIDAY_KEYS as readonly string[]).includes(value);

export interface BuiltInHoliday {
  date: DateString;
  /** Stable key, translated by the web app: "<country>.<name>". */
  key: BuiltInHolidayKey;
  /** For compensation days: the holiday that fell on a weekend. */
  compensates?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number): DateString =>
  `${year}-${pad(month)}-${pad(day)}`;

/** Western (Gregorian) Easter Sunday, "anonymous Gregorian algorithm" (Meeus/Jones/Butcher). */
export function westernEaster(year: number): DateString {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * Orthodox Easter Sunday as a Gregorian date (Julian computus, +13 days; valid for 1900–2099, far beyond
 * what a leave planner needs).
 */
export function orthodoxEaster(year: number): DateString {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(iso(year, month, day), 13);
}

function bulgaria(year: number): BuiltInHoliday[] {
  const easter = orthodoxEaster(year);
  const fixed: BuiltInHoliday[] = [
    { date: iso(year, 1, 1), key: 'BG.new_year' },
    { date: iso(year, 3, 3), key: 'BG.liberation_day' },
    { date: iso(year, 5, 1), key: 'BG.labour_day' },
    { date: iso(year, 5, 6), key: 'BG.st_george' },
    { date: iso(year, 5, 24), key: 'BG.culture_day' },
    { date: iso(year, 9, 6), key: 'BG.unification_day' },
    { date: iso(year, 9, 22), key: 'BG.independence_day' },
    { date: iso(year, 12, 24), key: 'BG.christmas_eve' },
    { date: iso(year, 12, 25), key: 'BG.christmas' },
    { date: iso(year, 12, 26), key: 'BG.christmas_second_day' },
  ];
  const movable: BuiltInHoliday[] = [
    { date: addDays(easter, -2), key: 'BG.good_friday' },
    { date: addDays(easter, -1), key: 'BG.holy_saturday' },
    { date: easter, key: 'BG.easter_sunday' },
    { date: addDays(easter, 1), key: 'BG.easter_monday' },
  ];
  // A fixed holiday on a Saturday or Sunday is made up on the next free working day (Labour Code).
  const taken = new Set([...fixed, ...movable].map((h) => h.date));
  const compensation: BuiltInHoliday[] = [];
  for (const holiday of [...fixed].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!isWeekend(holiday.date)) continue;
    let day = addDays(holiday.date, 1);
    while (isWeekend(day) || taken.has(day)) day = addDays(day, 1);
    taken.add(day);
    compensation.push({ date: day, key: 'BG.compensation_day', compensates: holiday.key });
  }
  return [...fixed, ...movable, ...compensation];
}

function germany(year: number): BuiltInHoliday[] {
  const easter = westernEaster(year);
  return [
    { date: iso(year, 1, 1), key: 'DE.new_year' },
    { date: addDays(easter, -2), key: 'DE.good_friday' },
    { date: addDays(easter, 1), key: 'DE.easter_monday' },
    { date: iso(year, 5, 1), key: 'DE.labour_day' },
    { date: addDays(easter, 39), key: 'DE.ascension_day' },
    { date: addDays(easter, 50), key: 'DE.whit_monday' },
    { date: iso(year, 10, 3), key: 'DE.unity_day' },
    { date: iso(year, 12, 25), key: 'DE.christmas' },
    { date: iso(year, 12, 26), key: 'DE.christmas_second_day' },
  ];
}

/** National public holidays of a country in a year, sorted by date. Unknown countries have none. */
export function builtInHolidays(
  country: string | null | undefined,
  year: number,
): BuiltInHoliday[] {
  if (!isBuiltInHolidayCountry(country)) return [];
  const list = country === 'BG' ? bulgaria(year) : germany(year);
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
