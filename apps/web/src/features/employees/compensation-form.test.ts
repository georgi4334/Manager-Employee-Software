import {
  MAX_AMOUNT_MINOR,
  compensationRequestSchema,
  type CompensationRow,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  compensationFormSchema,
  emptyCompensation,
  toCompensationRequest,
  type CompensationFormValues,
} from './compensation-form';

const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: CompensationFormValues = {
  validFrom: '2026-11-01',
  basis: 'monthly',
  amount: '3 500,50',
  currency: 'EUR',
};

describe('compensation form', () => {
  it('accepts a typed amount and maps it to what the API accepts', () => {
    expect(compensationFormSchema.safeParse(base).success).toBe(true);
    const body = toCompensationRequest(base);
    expect(body).toEqual({
      validFrom: '2026-11-01',
      basis: 'monthly',
      amountMinor: 350050,
      currency: 'EUR',
    });
    expect(compensationRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['3500', 350000],
    ['3500.5', 350050],
    ['3.500,50', 350050],
    ['12', 1200],
    ['0,01', 1],
  ])('reads %s as %d minor units', (amount, minor) => {
    expect(toCompensationRequest({ ...base, amount }).amountMinor).toBe(minor);
  });

  it.each([
    ['an empty amount', { amount: '' }],
    ['text', { amount: 'abc' }],
    ['zero', { amount: '0' }],
    ['a negative amount', { amount: '-5' }],
    ['three decimals', { amount: '10.505' }],
    ['an amount over the limit', { amount: String(MAX_AMOUNT_MINOR) }],
  ])('refuses %s with a translated message key', (_label, patch) => {
    expect(issues(compensationFormSchema.safeParse({ ...base, ...patch }))).toEqual([
      'amount:invalidAmount',
    ]);
  });

  it('refuses a bad date, an unknown basis and an unknown currency, like the API', () => {
    expect(issues(compensationFormSchema.safeParse({ ...base, validFrom: '1.11.2026' }))).toEqual([
      'validFrom:invalidDate',
    ]);
    expect(compensationFormSchema.safeParse({ ...base, basis: 'weekly' }).success).toBe(false);
    expect(compensationFormSchema.safeParse({ ...base, currency: 'XXX' }).success).toBe(false);
    // what the form refuses the API refuses too
    expect(
      compensationRequestSchema.safeParse(toCompensationRequest({ ...base, amount: '0' })).success,
    ).toBe(false);
  });

  it('starts from the record in force, or empty with the standard currency', () => {
    expect(emptyCompensation('2026-11-01')).toEqual({
      validFrom: '2026-11-01',
      basis: 'monthly',
      amount: '',
      currency: 'EUR',
    });
    const row: CompensationRow = {
      id: '0192f5a0-0000-7000-8000-000000000001',
      validFrom: '2026-01-01',
      basis: 'hourly',
      amountMinor: 1250,
      currency: 'BGN',
      current: true,
    };
    expect(emptyCompensation('2026-11-01', row)).toEqual({
      validFrom: '2026-11-01',
      basis: 'hourly',
      amount: '12.50',
      currency: 'BGN',
    });
  });
});
