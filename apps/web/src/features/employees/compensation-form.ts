import {
  COMPENSATION_BASES,
  COMPENSATION_CURRENCIES,
  DEFAULT_CURRENCY,
  moneyInput,
  parseMoney,
  type CompensationRequest,
  type CompensationRow,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see compensation-form.test.ts). */
export const compensationFormSchema = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' }),
  basis: z.enum(COMPENSATION_BASES),
  amount: z.string().refine((v) => parseMoney(v) !== null, { error: 'invalidAmount' }),
  currency: z.enum(COMPENSATION_CURRENCIES),
});
export type CompensationFormValues = z.input<typeof compensationFormSchema>;

export const emptyCompensation = (
  validFrom: string,
  latest?: CompensationRow,
): CompensationFormValues => ({
  validFrom,
  basis: latest?.basis ?? 'monthly',
  amount: latest ? moneyInput(latest.amountMinor) : '',
  currency: latest?.currency ?? DEFAULT_CURRENCY,
});

export const toCompensationRequest = (v: CompensationFormValues): CompensationRequest => ({
  validFrom: v.validFrom,
  basis: v.basis,
  amountMinor: parseMoney(v.amount) ?? 0,
  currency: v.currency,
});
