import { formatDuration, parseDuration, type WorkScheduleRequest } from '@intime/contracts';
import { z } from 'zod';

/** A day's hours as typed: "8", "7:30", "7,5"; empty or 0 is a day off. Null when it is not a duration. */
export function parseDayMinutes(text: string): number | null {
  const value = text.trim();
  if (value === '' || /^0+([:.,]0+)?$/.test(value)) return 0;
  return parseDuration(value);
}

const day = z.string().refine((v) => parseDayMinutes(v) !== null, { error: 'invalidDuration' });

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see schedule-form.test.ts). */
export const scheduleFormSchema = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' }),
  days: z.array(day).length(7),
});
export type ScheduleFormValues = z.input<typeof scheduleFormSchema>;

export const scheduleFormValues = (
  validFrom: string,
  minutes: readonly number[],
): ScheduleFormValues => ({
  validFrom,
  days: minutes.map((m) => (m === 0 ? '' : formatDuration(m))),
});

export const toScheduleRequest = (v: ScheduleFormValues): WorkScheduleRequest => ({
  validFrom: v.validFrom,
  minutes: v.days.map((d) => parseDayMinutes(d) ?? 0),
});
