import { MAX_RETENTION_MONTHS, MIN_RETENTION_MONTHS } from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const periodFormSchema = z.object({
  months: z
    .string()
    .trim()
    .regex(/^\d+$/, { error: 'invalidNumber' })
    .refine((v) => Number(v) >= MIN_RETENTION_MONTHS && Number(v) <= MAX_RETENTION_MONTHS, {
      error: 'invalidRetentionMonths',
    }),
});
export type PeriodFormValues = z.input<typeof periodFormSchema>;
