import { z } from 'zod';
import type { DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

/** Records only: nothing here computes pay (docs/adr/0030-compensation.md). */
export const COMPENSATION_BASES = ['monthly', 'yearly', 'hourly'] as const;
export type CompensationBasis = (typeof COMPENSATION_BASES)[number];
export const COMPENSATION_CURRENCIES = ['EUR', 'BGN', 'USD', 'GBP', 'CHF'] as const;
export type CompensationCurrency = (typeof COMPENSATION_CURRENCIES)[number];
export const DEFAULT_CURRENCY: CompensationCurrency = 'EUR';
/** Minor units (cents): at most 1 000 000 000.00 of a currency. */
export const MAX_AMOUNT_MINOR = 100_000_000_000;
export const MAX_COMPENSATION_ROWS = 50;

export interface CompensationRecord {
  validFrom: DateString;
}

/** The row in force on a date: the latest `validFrom` on or before it, or none. */
export function compensationFor<T extends CompensationRecord>(
  rows: readonly T[],
  date: DateString,
): T | null {
  let found: T | null = null;
  for (const r of rows) {
    if (r.validFrom <= date && (found === null || r.validFrom > found.validFrom)) found = r;
  }
  return found;
}

/**
 * Text typed by a person to minor units: `3500`, `3500.5`, `3 500,50`, `3.500,50` (one separator at most,
 * two decimals at most). `null` for anything else, for zero and for amounts above the limit.
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/[\s']/g, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  // The last separator is the decimal one when 1 or 2 digits follow it; otherwise separators group thousands.
  const match = /^(.*?)([.,])(\d{1,2})$/.exec(cleaned);
  const whole = match ? match[1]! : cleaned;
  const decimals = match ? match[3]! : '';
  if (!/^(\d+|\d{1,3}([.,]\d{3})+)$/.test(whole)) return null;
  const major = Number(whole.replace(/[.,]/g, ''));
  const minor = major * 100 + Number(decimals.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Minor units to the text of an input field (`3500.50`), the form `parseMoney` reads back. */
export function moneyInput(minor: number): string {
  const major = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(major) : `${major}.${String(cents).padStart(2, '0')}`;
}

export const compensationRequestSchema = z
  .object({
    validFrom: dateOnlySchema,
    basis: z.enum(COMPENSATION_BASES),
    amountMinor: z.number().int().min(1).max(MAX_AMOUNT_MINOR),
    currency: z.enum(COMPENSATION_CURRENCIES).default(DEFAULT_CURRENCY),
  })
  .strict();
export type CompensationRequest = z.infer<typeof compensationRequestSchema>;

export const compensationRowSchema = z.object({
  id: z.uuid(),
  validFrom: z.string(),
  basis: z.enum(COMPENSATION_BASES),
  amountMinor: z.number().int(),
  currency: z.enum(COMPENSATION_CURRENCIES),
  /** In force today. */
  current: z.boolean(),
});
export type CompensationRow = z.infer<typeof compensationRowSchema>;

export const compensationSchema = z.object({
  employeeId: z.uuid(),
  items: z.array(compensationRowSchema),
  canManage: z.boolean(),
});
export type Compensation = z.infer<typeof compensationSchema>;
