import { describe, expect, it } from 'vitest';
import {
  MAX_ATTENDANCE_NOTE,
  checkInRequestSchema,
  checkOutRequestSchema,
  createRecordRequestSchema,
  recordQuerySchema,
  updateRecordRequestSchema,
} from './attendance.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const entry = { date: '2026-10-20', startTime: '09:00', endTime: '17:30', mode: 'office' as const };

describe('check-in and check-out', () => {
  it('check-in needs a mode and trims the note', () => {
    expect(checkInRequestSchema.parse({ mode: 'remote', note: ' home ' })).toEqual({
      mode: 'remote',
      note: 'home',
    });
    expect(checkInRequestSchema.parse({ mode: 'office', note: '  ' })).toEqual({
      mode: 'office',
      note: undefined,
    });
    for (const body of [
      {},
      { mode: 'beach' },
      { mode: 'office', note: 'x'.repeat(MAX_ATTENDANCE_NOTE + 1) },
      { mode: 'office', employeeId: ID },
    ]) {
      expect(checkInRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(
      checkInRequestSchema.safeParse({ mode: 'office', note: 'x'.repeat(MAX_ATTENDANCE_NOTE) })
        .success,
    ).toBe(true);
  });

  it('check-out takes an optional ISO time with offset', () => {
    expect(checkOutRequestSchema.parse({})).toEqual({});
    expect(checkOutRequestSchema.safeParse({ at: '2026-10-24T17:00:00Z' }).success).toBe(true);
    expect(checkOutRequestSchema.safeParse({ at: '2026-10-24T17:00:00+03:00' }).success).toBe(true);
    for (const at of ['17:00', '2026-10-24', 'now', '2026-10-24T17:00:00']) {
      expect(checkOutRequestSchema.safeParse({ at }).success, at).toBe(false);
    }
  });
});

describe('typed-in records', () => {
  it('accepts a period within one day, for yourself or for somebody else', () => {
    expect(createRecordRequestSchema.safeParse(entry).success).toBe(true);
    expect(
      createRecordRequestSchema.safeParse({ ...entry, employeeId: ID, note: 'Client visit' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['an end before the start', { endTime: '08:00' }],
    ['an end equal to the start', { endTime: '09:00' }],
    ['a time with seconds', { startTime: '09:00:30' }],
    ['25 o’clock', { endTime: '25:00' }],
    ['a time without leading zero', { startTime: '9:00' }],
    ['a bad date', { date: '2026-02-30' }],
    ['an unknown mode', { mode: 'moon' }],
    ['a source (mass assignment)', { source: 'correction' }],
    ['a non-uuid employee', { employeeId: 'me' }],
  ])('rejects %s', (_label, patch) => {
    expect(createRecordRequestSchema.safeParse({ ...entry, ...patch }).success).toBe(false);
  });

  it('allows the whole day, up to 23:59', () => {
    expect(
      createRecordRequestSchema.safeParse({ ...entry, startTime: '00:00', endTime: '23:59' })
        .success,
    ).toBe(true);
  });
});

describe('updating a record', () => {
  it('is partial, and null clears the note', () => {
    expect(updateRecordRequestSchema.parse({ mode: 'remote' })).toEqual({ mode: 'remote' });
    expect(updateRecordRequestSchema.parse({ note: null })).toEqual({ note: null });
    expect(updateRecordRequestSchema.parse({ note: '  ' })).toEqual({ note: null });
    expect(updateRecordRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRecordRequestSchema.safeParse({ employeeId: ID }).success).toBe(false);
    expect(updateRecordRequestSchema.safeParse({ startTime: '9' }).success).toBe(false);
  });
});

describe('record query', () => {
  it('needs a period and refuses a backwards one', () => {
    expect(recordQuerySchema.parse({ from: '2026-10-19', to: '2026-10-25' })).toMatchObject({
      page: 1,
      pageSize: 100,
    });
    expect(recordQuerySchema.safeParse({ from: '2026-10-19' }).success).toBe(false);
    expect(recordQuerySchema.safeParse({ from: '2026-10-25', to: '2026-10-19' }).success).toBe(
      false,
    );
    expect(recordQuerySchema.safeParse({ from: '2026-10-19', to: '2026-10-19' }).success).toBe(
      true,
    );
    expect(
      recordQuerySchema.safeParse({ from: '2026-10-19', to: '2026-10-25', pageSize: '201' })
        .success,
    ).toBe(false);
    expect(
      recordQuerySchema.safeParse({ from: '2026-10-19', to: '2026-10-25', employeeId: 'x' })
        .success,
    ).toBe(false);
  });
});
