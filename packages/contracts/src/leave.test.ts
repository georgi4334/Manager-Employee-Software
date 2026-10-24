import { describe, expect, it } from 'vitest';
import {
  MAX_LEAVE_TEXT,
  SYSTEM_LEAVE_TYPES,
  SYSTEM_LEAVE_TYPE_KEYS,
  adjustBalanceRequestSchema,
  createHolidayRequestSchema,
  createLeaveRequestSchema,
  createLeaveTypeRequestSchema,
  decisionRequestSchema,
  leaveRequestQuerySchema,
  previewLeaveRequestSchema,
  updateLeaveSettingsRequestSchema,
  updateLeaveTypeRequestSchema,
} from './leave.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const request = { leaveTypeId: ID, startDate: '2026-11-02', endDate: '2026-11-06' };

describe('createLeaveRequestSchema', () => {
  it('defaults the half-day flags and drops an empty reason', () => {
    expect(createLeaveRequestSchema.parse({ ...request, reason: '   ' })).toEqual({
      ...request,
      halfDayStart: false,
      halfDayEnd: false,
      reason: undefined,
    });
    expect(createLeaveRequestSchema.parse({ ...request, reason: ' Family trip ' }).reason).toBe(
      'Family trip',
    );
  });

  it.each([
    ['a missing type', { ...request, leaveTypeId: undefined }],
    ['a non-uuid type', { ...request, leaveTypeId: 'annual' }],
    ['a bad date', { ...request, startDate: '2026-02-30' }],
    ['a date in the wrong format', { ...request, endDate: '06.11.2026' }],
    ['a reason that is too long', { ...request, reason: 'x'.repeat(MAX_LEAVE_TEXT + 1) }],
    ['an employee id (mass assignment)', { ...request, employeeId: ID }],
    ['a status (mass assignment)', { ...request, status: 'approved' }],
    ['non-boolean half-day flags', { ...request, halfDayStart: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(createLeaveRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a reason of exactly the maximum length', () => {
    expect(
      createLeaveRequestSchema.safeParse({ ...request, reason: 'x'.repeat(MAX_LEAVE_TEXT) })
        .success,
    ).toBe(true);
  });

  it('the preview takes the same range but no reason', () => {
    expect(previewLeaveRequestSchema.safeParse(request).success).toBe(true);
    expect(previewLeaveRequestSchema.safeParse({ ...request, reason: 'x' }).success).toBe(false);
  });
});

describe('decisionRequestSchema', () => {
  it('has an optional comment', () => {
    expect(decisionRequestSchema.parse({})).toEqual({});
    expect(decisionRequestSchema.parse({ comment: ' ok ' })).toEqual({ comment: 'ok' });
    expect(
      decisionRequestSchema.safeParse({ comment: 'x'.repeat(MAX_LEAVE_TEXT + 1) }).success,
    ).toBe(false);
    expect(decisionRequestSchema.safeParse({ status: 'approved' }).success).toBe(false);
  });
});

describe('leaveRequestQuerySchema', () => {
  it('applies defaults and coerces the query string', () => {
    expect(leaveRequestQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      leaveRequestQuerySchema.parse({ approvable: 'true', page: '2', status: 'pending' }),
    ).toMatchObject({
      approvable: true,
      page: 2,
      status: 'pending',
    });
  });

  it.each([
    ['an unknown status', { status: 'deleted' }],
    ['approvable=maybe', { approvable: 'maybe' }],
    ['a page size of 101', { pageSize: '101' }],
    ['a bad date', { from: 'yesterday' }],
    ['a non-uuid employee', { employeeId: 'me' }],
  ])('rejects %s', (_label, query) => {
    expect(leaveRequestQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('leave types and settings', () => {
  const type = {
    name: ' Study leave ',
    tracksBalance: false,
    requiresApproval: true,
    isSick: false,
    color: 'info',
  };

  it('creates a custom type', () => {
    expect(createLeaveTypeRequestSchema.parse(type).name).toBe('Study leave');
    expect(
      createLeaveTypeRequestSchema.parse({
        ...type,
        tracksBalance: true,
        allowanceDays: 5.5,
        carryOverMaxDays: 0,
      }),
    ).toMatchObject({ allowanceDays: 5.5 });
  });

  it.each([
    ['a hard-coded colour', { ...type, color: '#ff0000' }],
    ['a blank name', { ...type, name: ' ' }],
    ['an allowance in quarter days', { ...type, allowanceDays: 1.25 }],
    ['a negative allowance', { ...type, allowanceDays: -1 }],
    ['an allowance over a year', { ...type, allowanceDays: 366 }],
    ['a key (system types are fixed)', { ...type, key: 'annual' }],
  ])('rejects %s', (_label, body) => {
    expect(createLeaveTypeRequestSchema.safeParse(body).success).toBe(false);
  });

  it('updates partially but never with nothing', () => {
    expect(updateLeaveTypeRequestSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateLeaveTypeRequestSchema.safeParse({}).success).toBe(false);
    expect(updateLeaveTypeRequestSchema.safeParse({ key: 'sick' }).success).toBe(false);
  });

  it('the system types are consistent: only annual tracks a balance, only sick is sick', () => {
    expect(SYSTEM_LEAVE_TYPE_KEYS.filter((k) => SYSTEM_LEAVE_TYPES[k].tracksBalance)).toEqual([
      'annual',
    ]);
    expect(SYSTEM_LEAVE_TYPE_KEYS.filter((k) => SYSTEM_LEAVE_TYPES[k].isSick)).toEqual(['sick']);
    expect(SYSTEM_LEAVE_TYPES.sick.requiresApproval).toBe(false);
    expect(SYSTEM_LEAVE_TYPES.annual.allowanceDays).toBe(20);
  });

  it('settings: a country code or null, at least one field', () => {
    expect(updateLeaveSettingsRequestSchema.parse({ defaultCountry: 'bg' })).toEqual({
      defaultCountry: 'BG',
    });
    expect(updateLeaveSettingsRequestSchema.parse({ defaultCountry: null })).toEqual({
      defaultCountry: null,
    });
    expect(updateLeaveSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(updateLeaveSettingsRequestSchema.safeParse({ defaultCountry: 'BGR' }).success).toBe(
      false,
    );
  });
});

describe('holidays and balance adjustments', () => {
  it('holiday: defaults to all countries and a full day', () => {
    expect(createHolidayRequestSchema.parse({ date: '2026-12-31', name: 'Company day' })).toEqual({
      date: '2026-12-31',
      name: 'Company day',
      country: null,
      halfDay: false,
    });
    expect(createHolidayRequestSchema.safeParse({ date: '2026-12-31', name: '' }).success).toBe(
      false,
    );
  });

  const adjust = { employeeId: ID, leaveTypeId: ID, year: 2026, delta: 2 };
  it('adjustment: half-day steps, never zero, within the limit', () => {
    expect(adjustBalanceRequestSchema.safeParse(adjust).success).toBe(true);
    expect(adjustBalanceRequestSchema.safeParse({ ...adjust, delta: -0.5 }).success).toBe(true);
    expect(adjustBalanceRequestSchema.safeParse({ ...adjust, delta: 60 }).success).toBe(true);
    for (const delta of [0, 0.25, 61, -61]) {
      expect(adjustBalanceRequestSchema.safeParse({ ...adjust, delta }).success).toBe(false);
    }
    expect(adjustBalanceRequestSchema.safeParse({ ...adjust, year: 1999 }).success).toBe(false);
  });
});
