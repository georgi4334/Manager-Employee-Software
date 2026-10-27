import { daysBetween, type RecurrenceFreq, type RecurrenceRule } from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../../common/errors/app-exception.js';

export const dateOut = (date: Date): string => date.toISOString().slice(0, 10);
export const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);
export const notFound = (what: string) =>
  new AppException('NOT_FOUND', { message: `${what} not found` });
export const forbidden = (message: string) => new AppException('FORBIDDEN', { message });
export const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });

export const EVENT_SELECT = {
  id: true,
  scope: true,
  ownerEmployeeId: true,
  teamId: true,
  title: true,
  description: true,
  location: true,
  allDay: true,
  startDate: true,
  endDate: true,
  startsAt: true,
  endsAt: true,
  recurrenceFreq: true,
  recurrenceInterval: true,
  recurrenceWeekdays: true,
  recurrenceUntil: true,
  recurrenceCount: true,
  owner: { select: { id: true, firstName: true, lastName: true, userId: true } },
  team: { select: { id: true, name: true } },
  exceptions: { select: { originalDate: true } },
  attendees: {
    select: {
      id: true,
      employeeId: true,
      response: true,
      employee: { select: { id: true, firstName: true, lastName: true, userId: true } },
    },
  },
} satisfies Prisma.CalendarEventSelect;

export type EventRow = Prisma.CalendarEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** The series rule of a row, or null for a one-off event. */
export function ruleOf(row: {
  recurrenceFreq: string | null;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
}): RecurrenceRule | null {
  if (!row.recurrenceFreq) return null;
  return {
    freq: row.recurrenceFreq as RecurrenceFreq,
    interval: row.recurrenceInterval,
    weekdays: row.recurrenceWeekdays,
    until: row.recurrenceUntil ? dateOut(row.recurrenceUntil) : null,
    count: row.recurrenceCount,
  };
}

/** The columns of a rule (or of none). */
export const ruleColumns = (rule: RecurrenceRule | null) => ({
  recurrenceFreq: rule?.freq ?? null,
  recurrenceInterval: rule?.interval ?? 1,
  recurrenceWeekdays: rule ? [...rule.weekdays] : [],
  recurrenceUntil: rule?.until ? dateIn(rule.until) : null,
  recurrenceCount: rule?.count ?? null,
});

/** Whole days an event lasts beyond its first day (0 = a single day). */
export const durationDays = (row: { startDate: Date; endDate: Date }): number =>
  daysBetween(dateOut(row.startDate), dateOut(row.endDate));
