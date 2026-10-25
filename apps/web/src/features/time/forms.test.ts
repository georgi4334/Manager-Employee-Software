import {
  createTimeEntryRequestSchema,
  startTimerRequestSchema,
  updateTimeEntryRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyEntry,
  entryFormSchema,
  timerFormSchema,
  toCreateEntry,
  toStartTimer,
  toUpdateEntry,
  type EntryFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: EntryFormValues = { ...emptyEntry('2026-10-26'), projectId: ID, duration: '1:30' };

describe('time entry form', () => {
  it('accepts a minimal entry and maps it to what the API accepts', () => {
    expect(entryFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateEntry(base);
    expect(body).toEqual({
      projectId: ID,
      workDate: '2026-10-26',
      minutes: 90,
      isBillable: true,
    });
    expect(createTimeEntryRequestSchema.safeParse(body).success).toBe(true);
  });

  it('reads decimal hours with a comma, and sends task and note when given', () => {
    const body = toCreateEntry({ ...base, duration: '1,5', taskId: ID, note: ' x ' });
    expect(body).toMatchObject({ minutes: 90, taskId: ID, note: 'x' });
    expect(createTimeEntryRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no project', { projectId: '' }, ['projectId:required']],
    ['no duration', { duration: ' ' }, ['duration:required']],
    ['text as duration', { duration: 'abc' }, ['duration:invalidDuration']],
    ['zero', { duration: '0:00' }, ['duration:invalidDuration']],
    ['over 16 hours', { duration: '16:01' }, ['duration:invalidDuration']],
    ['sixty minutes', { duration: '1:60' }, ['duration:invalidDuration']],
    ['a bad date', { workDate: '26.10.2026' }, ['workDate:invalidDate']],
    ['no date', { workDate: '' }, ['workDate:required']],
    ['a long note', { note: 'x'.repeat(501) }, ['note:tooLong']],
  ])('refuses %s, as the API does', (_label, patch, expected) => {
    const values = { ...base, ...patch };
    expect(issues(entryFormSchema.safeParse(values))).toEqual(expected);
  });

  it('boundaries: one minute and sixteen hours are fine', () => {
    for (const duration of ['0:01', '16:00', '0.02']) {
      expect(entryFormSchema.safeParse({ ...base, duration }).success).toBe(true);
    }
  });

  it('sends only what changed when editing, and clears with null', () => {
    const current: EntryFormValues = {
      ...base,
      taskId: ID,
      note: 'old',
      duration: '1:30',
    };
    expect(toUpdateEntry(current, current)).toEqual({});
    expect(toUpdateEntry({ ...current, duration: '1.5' }, current)).toEqual({}); // same minutes
    const changed = toUpdateEntry(
      { ...current, taskId: '', note: '', duration: '2:00', isBillable: false },
      current,
    );
    expect(changed).toEqual({ taskId: null, note: null, minutes: 120, isBillable: false });
    expect(updateTimeEntryRequestSchema.safeParse(changed).success).toBe(true);
    expect(toUpdateEntry({ ...current, workDate: '2026-10-27' }, current)).toEqual({
      workDate: '2026-10-27',
    });
  });
});

describe('timer form', () => {
  it('needs a project, and sends the task and note only when given', () => {
    expect(issues(timerFormSchema.safeParse({ projectId: '', taskId: '', note: '' }))).toEqual([
      'projectId:required',
    ]);
    const bare = toStartTimer({ projectId: ID, taskId: '', note: '  ' });
    expect(bare).toEqual({ projectId: ID });
    const full = toStartTimer({ projectId: ID, taskId: ID, note: ' x ' });
    expect(full).toEqual({ projectId: ID, taskId: ID, note: 'x' });
    expect(startTimerRequestSchema.safeParse(bare).success).toBe(true);
    expect(startTimerRequestSchema.safeParse(full).success).toBe(true);
  });
  it('refuses a long note', () => {
    expect(
      issues(timerFormSchema.safeParse({ projectId: ID, taskId: '', note: 'x'.repeat(501) })),
    ).toEqual(['note:tooLong']);
  });
});
