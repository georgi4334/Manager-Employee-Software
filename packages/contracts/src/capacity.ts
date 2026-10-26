import { z } from 'zod';
import { daysBetween, isWeekend, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

/** Everybody is measured against the same standard day for now (docs/adr/0018-capacity.md). */
export const WORKDAY_MINUTES = 8 * 60;
export const MAX_CAPACITY_DAYS = 31;
/** From this share of the available time on, a person counts as "full". */
export const FULL_PERCENT = 80;

export const CAPACITY_LEVELS = ['none', 'free', 'busy', 'full', 'over'] as const;
export type CapacityLevel = (typeof CAPACITY_LEVELS)[number];
export const DAY_STATUSES = [
  'off',
  'leave',
  'partly_leave',
  'free',
  'busy',
  'full',
  'over',
] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/**
 * Working minutes of a date before leave: none on weekends, full holidays and outside the employment, half a day
 * on a half-day holiday.
 */
export function workingMinutes(
  date: DateString,
  options: {
    holiday?: { halfDay: boolean } | undefined;
    hireDate?: DateString | null;
    terminationDate?: DateString | null;
    /** The person's contractual minutes of this date (ADR 0026); without it the standard week applies. */
    scheduledMinutes?: number | undefined;
  } = {},
): number {
  const base = options.scheduledMinutes ?? (isWeekend(date) ? 0 : WORKDAY_MINUTES);
  if (base <= 0) return 0;
  if (options.hireDate && date < options.hireDate) return 0;
  if (options.terminationDate && date > options.terminationDate) return 0;
  if (options.holiday) return options.holiday.halfDay ? Math.round(base / 2) : 0;
  return base;
}

/**
 * What is left of the working minutes after approved leave (1 = a whole day, 0.5 = half a day). A leave day takes its
 * share of the day's contractual minutes (`dayMinutes`, the standard day without a schedule).
 */
export const availableMinutes = (
  working: number,
  leaveFraction: number,
  dayMinutes: number = WORKDAY_MINUTES,
): number => Math.max(0, working - Math.round(leaveFraction * dayMinutes));

/** Logged time beyond what was available on a day; a day off counts in full. Informational (ADR 0026). */
export const overtimeMinutes = (logged: number, available: number): number =>
  Math.max(0, logged - Math.max(0, available));

/** The time one assignment claims of an available stretch. */
export const assignmentMinutes = (available: number, allocationPercent: number): number =>
  Math.round((available * allocationPercent) / 100);

/**
 * The available time promised to projects: every covering assignment claims its percentage (rounded per
 * assignment, so the parts always add up to the whole).
 */
export const plannedMinutes = (available: number, allocationPercents: readonly number[]): number =>
  allocationPercents.reduce((sum, p) => sum + assignmentMinutes(available, p), 0);

/** How full a period is. More planned than available is over-booking: shown, never blocked. */
export function loadLevel(planned: number, available: number): CapacityLevel {
  if (available <= 0) return 'none';
  if (planned <= 0) return 'free';
  const ratio = planned / available;
  if (ratio > 1) return 'over';
  return ratio >= FULL_PERCENT / 100 ? 'full' : 'busy';
}

/** The same for one day, in words that also cover days nobody works. */
export function dayStatus(day: {
  working: number;
  leaveFraction: number;
  available: number;
  planned: number;
}): DayStatus {
  if (day.leaveFraction >= 1) return 'leave';
  if (day.working === 0) return 'off';
  if (day.leaveFraction > 0) return 'partly_leave';
  const level = loadLevel(day.planned, day.available);
  return level === 'none' ? 'off' : level;
}

export const freeMinutes = (available: number, planned: number): number =>
  Math.max(0, available - planned);

// ----- API -------------------------------------------------------------------------------------

export const capacityQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    projectId: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => v.to >= v.from, { path: ['to'], error: 'end_before_start' })
  .refine((v) => v.to < v.from || daysBetween(v.from, v.to) < MAX_CAPACITY_DAYS, {
    path: ['to'],
    error: 'too_long',
  });
export type CapacityQuery = z.infer<typeof capacityQuerySchema>;

export const capacityPersonSchema = z.object({
  employee: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  availableMinutes: z.number().int(),
  plannedMinutes: z.number().int(),
  loggedMinutes: z.number().int(),
  /** Logged beyond available, summed per day (ADR 0026). */
  overtimeMinutes: z.number().int().min(0),
  freeMinutes: z.number().int(),
  level: z.enum(CAPACITY_LEVELS),
  days: z.array(
    z.object({
      date: z.string(),
      availableMinutes: z.number().int(),
      plannedMinutes: z.number().int(),
      loggedMinutes: z.number().int(),
      status: z.enum(DAY_STATUSES),
    }),
  ),
  /** Projects the caller may see; the rest is summed in one row without an id. */
  projects: z.array(
    z.object({
      id: z.uuid().nullable(),
      code: z.string().nullable(),
      name: z.string().nullable(),
      plannedMinutes: z.number().int(),
      loggedMinutes: z.number().int(),
    }),
  ),
});
export type CapacityPerson = z.infer<typeof capacityPersonSchema>;

export const capacitySchema = z.object({
  from: z.string(),
  to: z.string(),
  items: z.array(capacityPersonSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type Capacity = z.infer<typeof capacitySchema>;
