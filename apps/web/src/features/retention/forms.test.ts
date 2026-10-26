import { updateRetentionRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { periodFormSchema } from './forms';

describe('retention period form', () => {
  it.each(['12', '60', '600', ' 36 '])('accepts %j, as the API does', (months) => {
    expect(periodFormSchema.safeParse({ months }).success).toBe(true);
    expect(
      updateRetentionRequestSchema.safeParse({ formerEmployeeMonths: Number(months) }).success,
    ).toBe(true);
  });

  it.each(['11', '601', '0', '12.5', 'x', '', '-5'])('refuses %j, as the API does', (months) => {
    expect(periodFormSchema.safeParse({ months }).success).toBe(false);
    expect(
      updateRetentionRequestSchema.safeParse({ formerEmployeeMonths: Number(months) }).success,
    ).toBe(false);
  });

  it('names the problem with a key of errors:validation', () => {
    const issue = (months: string) => {
      const r = periodFormSchema.safeParse({ months });
      return r.success ? null : r.error.issues[0]?.message;
    };
    expect(issue('x')).toBe('invalidNumber');
    expect(issue('601')).toBe('invalidRetentionMonths');
  });
});
