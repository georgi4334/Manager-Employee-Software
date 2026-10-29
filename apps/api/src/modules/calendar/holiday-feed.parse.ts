import type { PublicHolidayCountry, PublicHolidayLanguage } from '@intime/contracts';
import { z } from 'zod';

export interface FeedHoliday {
  date: string;
  endDate: string;
  name: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Lenient on purpose: unknown fields are ignored and a malformed entry is skipped, never fatal.
const entrySchema = z.object({
  startDate: z.string().regex(DATE),
  endDate: z.string().regex(DATE).optional(),
  type: z.string().optional(),
  nationwide: z.boolean().optional(),
  name: z.array(z.object({ language: z.string(), text: z.string() })).default([]),
  subdivisions: z.array(z.object({ code: z.string() })).optional(),
});

/** Public holidays only; the feed also lists school holidays, observances and so on. */
const PUBLIC_TYPES = new Set(['public', 'bank']);

/** England inside the United Kingdom's data (ADR 0035). */
const ENGLAND = 'GB-ENG';

/** Whether a holiday counts for the country: nationwide, and for England also the days listed for GB-ENG. */
function applies(country: PublicHolidayCountry, entry: z.infer<typeof entrySchema>): boolean {
  if (entry.nationwide) return true;
  if (country !== 'GB') return false;
  return (entry.subdivisions ?? []).some((s) => s.code === ENGLAND);
}

function pickName(
  names: { language: string; text: string }[],
  language: PublicHolidayLanguage,
): string | null {
  const wanted = language.toUpperCase();
  const found =
    names.find((n) => n.language.toUpperCase() === wanted) ??
    names.find((n) => n.language.toUpperCase() === 'EN') ??
    names[0];
  const text = found?.text.trim();
  return text ? text.slice(0, 120) : null;
}

/** Turns the OpenHolidays `PublicHolidays` answer into plain days; anything unusable is dropped. */
export function parseOpenHolidays(
  json: unknown,
  country: PublicHolidayCountry,
  language: PublicHolidayLanguage,
): FeedHoliday[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: FeedHoliday[] = [];
  for (const raw of json) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (!PUBLIC_TYPES.has((entry.type ?? 'Public').toLowerCase())) continue;
    if (!applies(country, entry)) continue;
    const name = pickName(entry.name, language);
    const endDate =
      entry.endDate && entry.endDate >= entry.startDate ? entry.endDate : entry.startDate;
    if (!name) continue;
    const key = `${entry.startDate}|${endDate}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: entry.startDate, endDate, name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
