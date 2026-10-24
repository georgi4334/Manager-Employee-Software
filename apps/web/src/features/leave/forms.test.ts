import {
  adjustBalanceRequestSchema,
  createHolidayRequestSchema,
  createLeaveRequestSchema,
  createLeaveTypeRequestSchema,
  previewLeaveRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  adjustFormSchema,
  holidayFormSchema,
  requestFormSchema,
  settingsFormSchema,
  toAdjustRequest,
  toHolidayRequest,
  toPreview,
  toRequest,
  toTypeRequest,
  typeFormSchema,
  type RequestFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const request: RequestFormValues = {
  leaveTypeId: ID,
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  halfDayStart: false,
  halfDayEnd: false,
  reason: ' Family trip ',
};

describe('request form', () => {
  it('accepts a valid request and maps to what the API accepts', () => {
    expect(requestFormSchema.safeParse(request).success).toBe(true);
    const body = toRequest(request, false);
    expect(body.reason).toBe('Family trip');
    expect(createLeaveRequestSchema.safeParse(body).success).toBe(true);
    expect(previewLeaveRequestSchema.safeParse(toPreview(request)).success).toBe(true);
  });

  it('never sends a reason for sick leave, nor an empty one', () => {
    expect(toRequest(request, true).reason).toBeUndefined();
    expect(toRequest({ ...request, reason: '   ' }, false).reason).toBeUndefined();
  });

  it('reports what is missing or contradictory with the same rules as the API', () => {
    const empty = { ...request, leaveTypeId: '', startDate: '', endDate: '' };
    expect(issues(requestFormSchema.safeParse(empty)).sort()).toEqual([
      'endDate:required',
      'leaveTypeId:required',
      'startDate:required',
    ]);
    expect(issues(requestFormSchema.safeParse({ ...request, endDate: '2026-11-01' }))).toEqual([
      'endDate:end_before_start',
    ]);
    expect(
      issues(
        requestFormSchema.safeParse({
          ...request,
          endDate: request.startDate,
          halfDayStart: true,
          halfDayEnd: true,
        }),
      ),
    ).toEqual(['halfDayEnd:half_day_conflict']);
    expect(issues(requestFormSchema.safeParse({ ...request, reason: 'x'.repeat(301) }))).toEqual([
      'reason:tooLong',
    ]);
  });
});

describe('type form', () => {
  const type = {
    name: ' Study ',
    tracksBalance: true,
    requiresApproval: true,
    isSick: false,
    color: 'info' as const,
    isActive: true,
    allowanceDays: '5.5',
    carryOverMaxDays: '0',
  };

  it('maps to a create request, sending the policy only for balance types', () => {
    expect(typeFormSchema.safeParse(type).success).toBe(true);
    const body = toTypeRequest(type);
    expect(body).toMatchObject({ name: 'Study', allowanceDays: 5.5, carryOverMaxDays: 0 });
    expect(createLeaveTypeRequestSchema.safeParse(body).success).toBe(true);
    const free = toTypeRequest({ ...type, tracksBalance: false });
    expect(free).not.toHaveProperty('allowanceDays');
    expect(createLeaveTypeRequestSchema.safeParse(free).success).toBe(true);
  });

  it.each([
    ['a blank name', { name: ' ' }, 'name:required'],
    ['quarter days', { allowanceDays: '1.25' }, 'allowanceDays:invalidDays'],
    ['text as days', { carryOverMaxDays: 'lots' }, 'carryOverMaxDays:invalidDays'],
    ['an empty allowance', { allowanceDays: '' }, 'allowanceDays:required'],
  ])('rejects %s', (_label, patch, expected) => {
    expect(issues(typeFormSchema.safeParse({ ...type, ...patch }))).toContain(expected);
  });
});

describe('holiday, settings and adjustment forms', () => {
  it('holiday: maps an empty country to "everybody" and upper-cases codes', () => {
    const body = toHolidayRequest({
      date: '2026-12-31',
      name: ' Company day ',
      country: '',
      halfDay: false,
    });
    expect(body).toEqual({
      date: '2026-12-31',
      name: 'Company day',
      country: null,
      halfDay: false,
    });
    expect(createHolidayRequestSchema.safeParse(body).success).toBe(true);
    expect(
      toHolidayRequest({ date: '2026-12-31', name: 'x', country: 'de', halfDay: true }).country,
    ).toBe('DE');
    expect(
      issues(
        holidayFormSchema.safeParse({ date: '', name: '', country: 'DEU', halfDay: false }),
      ).sort(),
    ).toEqual(['country:invalidCountry', 'date:required', 'name:required']);
  });

  it('settings: a country is two letters or empty', () => {
    expect(
      settingsFormSchema.safeParse({ hideSickTypeFromTeam: true, defaultCountry: '' }).success,
    ).toBe(true);
    expect(
      settingsFormSchema.safeParse({ hideSickTypeFromTeam: true, defaultCountry: 'bg' }).success,
    ).toBe(true);
    expect(
      issues(settingsFormSchema.safeParse({ hideSickTypeFromTeam: true, defaultCountry: 'BGR' })),
    ).toEqual(['defaultCountry:invalidCountry']);
  });

  it('adjustment: half days, never zero, within the limit', () => {
    const base = { employeeId: ID, year: '2026', delta: '2.5' };
    expect(adjustFormSchema.safeParse(base).success).toBe(true);
    const body = toAdjustRequest(base, ID);
    expect(body).toEqual({ employeeId: ID, leaveTypeId: ID, year: 2026, delta: 2.5 });
    expect(adjustBalanceRequestSchema.safeParse(body).success).toBe(true);
    for (const delta of ['0', '0.25', '61', '-61', '', 'x']) {
      expect(adjustFormSchema.safeParse({ ...base, delta }).success, delta).toBe(false);
    }
    expect(adjustFormSchema.safeParse({ ...base, delta: '-60' }).success).toBe(true);
    expect(adjustFormSchema.safeParse({ ...base, year: '26' }).success).toBe(false);
    expect(adjustFormSchema.safeParse({ ...base, employeeId: '' }).success).toBe(false);
  });
});
