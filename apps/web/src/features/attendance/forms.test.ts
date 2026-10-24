import { createRecordRequestSchema, updateRecordRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  openRecordFormSchema,
  recordFormSchema,
  toCreateRequest,
  toOpenUpdate,
  toUpdateRequest,
  type RecordFormValues,
} from './forms';

const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: RecordFormValues = {
  employeeId: '',
  date: '2026-10-20',
  startTime: '09:00',
  endTime: '17:30',
  mode: 'office',
  note: ' Client visit ',
};

describe('record form', () => {
  it('accepts a valid record and maps to what the API accepts', () => {
    expect(recordFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateRequest(base);
    expect(body.note).toBe('Client visit');
    expect(body).not.toHaveProperty('employeeId');
    expect(createRecordRequestSchema.safeParse(body).success).toBe(true);
    expect(updateRecordRequestSchema.safeParse(toUpdateRequest(base)).success).toBe(true);
  });

  it('sends the person only when one was picked, and no empty note', () => {
    const id = '0192f5a0-0000-7000-8000-00000000000a';
    expect(toCreateRequest({ ...base, employeeId: id, note: '  ' })).toEqual({
      employeeId: id,
      date: base.date,
      startTime: '09:00',
      endTime: '17:30',
      mode: 'office',
    });
    expect(toUpdateRequest({ ...base, note: ' ' }).note).toBeNull(); // clears the note
  });

  it.each([
    ['empty times', { startTime: '', endTime: '' }, ['startTime:required', 'endTime:required']],
    ['a bad time', { startTime: '9am' }, ['startTime:invalidTime']],
    ['hour 24', { endTime: '24:00' }, ['endTime:invalidTime']],
    ['minute 60', { endTime: '10:60' }, ['endTime:invalidTime']],
    [
      'an end before the start',
      { startTime: '17:00', endTime: '09:00' },
      ['endTime:end_before_start'],
    ],
    [
      'an end equal to the start',
      { startTime: '09:00', endTime: '09:00' },
      ['endTime:end_before_start'],
    ],
    ['a bad date', { date: '20.10.2026' }, ['date:invalidDate']],
    ['an empty date', { date: '' }, ['date:required']],
    ['a long note', { note: 'x'.repeat(201) }, ['note:tooLong']],
  ] as const)('refuses %s, as the API does', (_label, patch, expected) => {
    const values = { ...base, ...patch };
    expect(issues(recordFormSchema.safeParse(values))).toEqual(expected);
    // the server side rejects the same input
    expect(createRecordRequestSchema.safeParse(toCreateRequest(values)).success).toBe(false);
  });

  it('keeps only mode and note for an open record', () => {
    const v = { mode: 'remote' as const, note: ' home ' };
    expect(openRecordFormSchema.safeParse(v).success).toBe(true);
    expect(toOpenUpdate(v)).toEqual({ mode: 'remote', note: 'home' });
    expect(updateRecordRequestSchema.safeParse(toOpenUpdate(v)).success).toBe(true);
    expect(issues(openRecordFormSchema.safeParse({ ...v, note: 'x'.repeat(201) }))).toEqual([
      'note:tooLong',
    ]);
  });
});
