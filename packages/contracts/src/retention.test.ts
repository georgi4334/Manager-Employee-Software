import { describe, expect, it } from 'vitest';
import {
  MAX_RETENTION_MONTHS,
  MIN_RETENTION_MONTHS,
  RETENTION_PRESETS,
  addMonths,
  isRetentionDue,
  isRetentionUpcoming,
  retentionDueDate,
  retentionHoldRequestSchema,
  updateRetentionRequestSchema,
} from './retention.js';

describe('addMonths', () => {
  it.each([
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-01-15', 12, '2027-01-15'],
    ['2026-11-30', 3, '2027-02-28'], // the day does not exist: the last day of the month
    ['2024-01-31', 1, '2024-02-29'], // leap year
    ['2023-01-31', 1, '2023-02-28'],
    ['2026-12-31', 1, '2027-01-31'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-05-10', 0, '2026-05-10'],
    ['2026-10-26', 60, '2031-10-26'],
  ])('%s + %i months = %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });
});

describe('retention due dates', () => {
  it('uses the Bulgarian preset of 60 months', () => {
    expect(RETENTION_PRESETS.BG.formerEmployeeMonths).toBe(60);
    expect(retentionDueDate('2021-03-15', 60)).toBe('2026-03-15');
  });

  it('is due on the due date itself, not the day before', () => {
    expect(isRetentionDue('2021-03-15', 60, '2026-03-14')).toBe(false);
    expect(isRetentionDue('2021-03-15', 60, '2026-03-15')).toBe(true);
    expect(isRetentionDue('2021-03-15', 60, '2030-01-01')).toBe(true);
  });

  it('is upcoming within the preview window and not beyond it', () => {
    expect(isRetentionUpcoming('2021-03-15', 60, '2026-03-01')).toBe(true); // due in 14 days
    expect(isRetentionUpcoming('2021-03-15', 60, '2025-12-15')).toBe(true); // due in exactly 90 days
    expect(isRetentionUpcoming('2021-03-15', 60, '2025-12-14')).toBe(false); // 91 days
    expect(isRetentionUpcoming('2021-03-15', 60, '2027-01-01')).toBe(true); // already due counts too
  });
});

describe('updateRetentionRequestSchema', () => {
  it('accepts one or more fields within the limits', () => {
    expect(updateRetentionRequestSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(
      updateRetentionRequestSchema.safeParse({ formerEmployeeMonths: MIN_RETENTION_MONTHS })
        .success,
    ).toBe(true);
    expect(
      updateRetentionRequestSchema.safeParse({
        formerEmployeeMonths: MAX_RETENTION_MONTHS,
        country: 'BG',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['nothing', {}],
    ['too few months', { formerEmployeeMonths: MIN_RETENTION_MONTHS - 1 }],
    ['too many months', { formerEmployeeMonths: MAX_RETENTION_MONTHS + 1 }],
    ['half a month', { formerEmployeeMonths: 12.5 }],
    ['another country', { country: 'DE' }],
    ['text instead of a boolean', { enabled: 'yes' }],
    ['an unknown field', { enabled: true, extra: 1 }],
  ])('refuses %s', (_name, body) => {
    expect(updateRetentionRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('retentionHoldRequestSchema', () => {
  it('needs a boolean and nothing else', () => {
    expect(retentionHoldRequestSchema.safeParse({ held: true }).success).toBe(true);
    expect(retentionHoldRequestSchema.safeParse({ held: false }).success).toBe(true);
    expect(retentionHoldRequestSchema.safeParse({}).success).toBe(false);
    expect(retentionHoldRequestSchema.safeParse({ held: 'true' }).success).toBe(false);
    expect(retentionHoldRequestSchema.safeParse({ held: true, reason: 'x' }).success).toBe(false);
  });
});
