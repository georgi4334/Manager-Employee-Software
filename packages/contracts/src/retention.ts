import { z } from 'zod';
import { addDays, type DateString } from './dates.js';

/** Countries with a reviewed retention preset (ADR 0027). Others need their own review first. */
export const RETENTION_COUNTRIES = ['BG'] as const;
export type RetentionCountry = (typeof RETENTION_COUNTRIES)[number];

export const MIN_RETENTION_MONTHS = 12;
export const MAX_RETENTION_MONTHS = 600;
/** The preview shows who is due now or within this many days. */
export const RETENTION_PREVIEW_DAYS = 90;
export const RETENTION_PREVIEW_LIMIT = 100;
/** People erased per workspace and run; the rest wait for the next run. */
export const RETENTION_BATCH = 25;

/**
 * Product defaults, not legal advice: the employer confirms them with its legal adviser (ADR 0027). Bulgaria: a former
 * employee is anonymised 60 months after the termination date.
 */
export const RETENTION_PRESETS: Record<RetentionCountry, { formerEmployeeMonths: number }> = {
  BG: { formerEmployeeMonths: 60 },
};

/** The date `months` months after `date`; a day that does not exist in the target month becomes its last day. */
export function addMonths(date: DateString, months: number): DateString {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The day a former employee falls due for erasure: the termination date plus the retention period. */
export const retentionDueDate = (terminationDate: DateString, months: number): DateString =>
  addMonths(terminationDate, months);

/** Due on the due date itself. */
export const isRetentionDue = (terminationDate: DateString, months: number, today: DateString) =>
  retentionDueDate(terminationDate, months) <= today;

/** Due now or within the preview window. */
export const isRetentionUpcoming = (
  terminationDate: DateString,
  months: number,
  today: DateString,
  days: number = RETENTION_PREVIEW_DAYS,
) => retentionDueDate(terminationDate, months) <= addDays(today, days);

export const retentionPolicySchema = z.object({
  country: z.enum(RETENTION_COUNTRIES),
  enabled: z.boolean(),
  formerEmployeeMonths: z.number().int(),
  lastRunAt: z.string().nullable(),
  lastRunErased: z.number().int().min(0),
  /** The preset the workspace would get, shown next to the chosen value. */
  presetMonths: z.number().int(),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const updateRetentionRequestSchema = z
  .object({
    country: z.enum(RETENTION_COUNTRIES).optional(),
    enabled: z.boolean().optional(),
    formerEmployeeMonths: z
      .number()
      .int()
      .min(MIN_RETENTION_MONTHS)
      .max(MAX_RETENTION_MONTHS)
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'empty_update' });
export type UpdateRetentionRequest = z.infer<typeof updateRetentionRequestSchema>;

export const retentionCandidateSchema = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  terminationDate: z.string(),
  dueDate: z.string(),
  /** Already due: would be erased by the next run. */
  due: z.boolean(),
  held: z.boolean(),
});
export type RetentionCandidate = z.infer<typeof retentionCandidateSchema>;

export const retentionOverviewSchema = z.object({
  policy: retentionPolicySchema,
  today: z.string(),
  candidates: z.array(retentionCandidateSchema),
  /** Inactive people without a termination date: never erased automatically. */
  withoutTerminationDate: z.number().int().min(0),
});
export type RetentionOverview = z.infer<typeof retentionOverviewSchema>;

export const retentionHoldRequestSchema = z.object({ held: z.boolean() }).strict();
export type RetentionHoldRequest = z.infer<typeof retentionHoldRequestSchema>;
