import { describe, expect, it } from 'vitest';
import {
  OFF_TRACK_AFTER_DAYS,
  createAssignmentRequestSchema,
  createClientRequestSchema,
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  endedAt,
  overdueDays,
  peakAllocation,
  projectHealth,
  projectQuerySchema,
  updateAssignmentRequestSchema,
  updateClientRequestSchema,
  updateProjectRequestSchema,
} from './projects.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const TODAY = '2026-11-10';
const open = (dueDate: string) => ({ dueDate, status: 'open' as const });
const done = (dueDate: string) => ({ dueDate, status: 'done' as const });
const health = (o: Partial<Parameters<typeof projectHealth>[0]> = {}) =>
  projectHealth({ status: 'active', endDate: null, today: TODAY, milestones: [], ...o });

describe('project health', () => {
  it('only active projects have one', () => {
    for (const status of ['planned', 'paused', 'done'] as const) {
      expect(health({ status, milestones: [open('2020-01-01')] })).toBeNull();
    }
  });
  it('is on track without trouble, also with no milestones at all', () => {
    expect(health()).toBe('on_track');
    expect(health({ milestones: [open('2026-12-01'), done('2026-10-01')] })).toBe('on_track');
  });
  it('treats a milestone due today as not yet overdue', () => {
    expect(health({ milestones: [open(TODAY)] })).toBe('on_track');
  });
  it('is at risk up to the limit and off track beyond it', () => {
    expect(health({ milestones: [open('2026-11-09')] })).toBe('at_risk'); // 1 day
    expect(health({ milestones: [open('2026-11-03')] })).toBe('at_risk'); // exactly 7 days
    expect(OFF_TRACK_AFTER_DAYS).toBe(7);
    expect(health({ milestones: [open('2026-11-02')] })).toBe('off_track'); // 8 days
  });
  it('ignores finished milestones and looks at the worst open one', () => {
    expect(health({ milestones: [done('2026-01-01'), open('2026-11-09')] })).toBe('at_risk');
    expect(health({ milestones: [open('2026-11-09'), open('2026-10-01')] })).toBe('off_track');
  });
  it('is off track once the end date has passed while still active', () => {
    expect(health({ endDate: '2026-11-09' })).toBe('off_track');
    expect(health({ endDate: TODAY })).toBe('on_track'); // the last day is still a working day
  });
  it('is at risk shortly before the end with work still open, not without', () => {
    expect(health({ endDate: '2026-11-15', milestones: [open('2026-11-14')] })).toBe('at_risk');
    expect(health({ endDate: '2026-11-17', milestones: [open('2026-11-14')] })).toBe('at_risk'); // 7 days
    expect(health({ endDate: '2026-11-18', milestones: [open('2026-11-14')] })).toBe('on_track');
    expect(health({ endDate: '2026-11-15', milestones: [done('2026-11-01')] })).toBe('on_track');
  });
  it('counts overdue days', () => {
    expect(overdueDays(open('2026-11-07'), TODAY)).toBe(3);
    expect(overdueDays(open('2026-11-20'), TODAY)).toBe(0);
    expect(overdueDays(done('2026-11-07'), TODAY)).toBe(0);
  });
});

describe('peak allocation', () => {
  const r = (fromDate: string, toDate: string | null, allocationPct: number) => ({
    fromDate,
    toDate,
    allocationPct,
  });
  const window = { fromDate: '2026-11-01', toDate: '2026-11-30' };

  it('is zero without any range, and sums ranges that overlap', () => {
    expect(peakAllocation([], window)).toBe(0);
    expect(
      peakAllocation(
        [r('2026-11-01', '2026-11-30', 60), r('2026-11-10', '2026-11-20', 50)],
        window,
      ),
    ).toBe(110);
  });
  it('does not add ranges that only follow each other', () => {
    expect(
      peakAllocation(
        [r('2026-11-01', '2026-11-10', 80), r('2026-11-11', '2026-11-30', 80)],
        window,
      ),
    ).toBe(80);
  });
  it('counts a shared boundary day on both sides', () => {
    expect(
      peakAllocation(
        [r('2026-11-01', '2026-11-10', 80), r('2026-11-10', '2026-11-30', 80)],
        window,
      ),
    ).toBe(160);
  });
  it('ignores ranges outside the window and honours open ends', () => {
    expect(
      peakAllocation([r('2026-10-01', '2026-10-31', 90), r('2026-12-01', null, 90)], window),
    ).toBe(0);
    expect(peakAllocation([r('2026-10-01', null, 70)], window)).toBe(70);
    expect(
      peakAllocation([r('2026-10-01', '2026-11-01', 100), r('2026-11-01', null, 20)], window),
    ).toBe(120);
  });
  it('works for an open window', () => {
    expect(
      peakAllocation([r('2026-11-01', null, 60), r('2027-03-01', '2027-03-31', 60)], {
        fromDate: '2026-11-01',
        toDate: null,
      }),
    ).toBe(120);
  });
});

describe('offboarding helper', () => {
  it('cuts an assignment at the cutoff, never extends it', () => {
    expect(endedAt(null, '2026-11-10')).toBe('2026-11-10');
    expect(endedAt('2026-12-31', '2026-11-10')).toBe('2026-11-10');
    expect(endedAt('2026-11-01', '2026-11-10')).toBe('2026-11-01');
  });
});

describe('client requests', () => {
  it('needs a name, trims and lower-cases the email, and drops empty text', () => {
    expect(
      createClientRequestSchema.parse({
        name: ' Acme ',
        contactEmail: ' Ann@Acme.EU ',
        notes: ' ',
      }),
    ).toEqual({
      name: 'Acme',
      contactEmail: 'ann@acme.eu',
      notes: undefined,
    });
    for (const body of [
      {},
      { name: ' ' },
      { name: 'x'.repeat(121) },
      { name: 'A', contactEmail: 'nope' },
      { name: 'A', status: 'archived' },
    ]) {
      expect(createClientRequestSchema.safeParse(body).success).toBe(false);
    }
  });
  it('updates partially, clears with empty text, and refuses an empty or unknown change', () => {
    expect(updateClientRequestSchema.parse({ notes: ' ', status: 'archived' })).toEqual({
      notes: null,
      status: 'archived',
    });
    for (const body of [{}, { status: 'gone' }, { id: ID }]) {
      expect(updateClientRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('project requests', () => {
  const valid = { code: 'web-1', name: 'Website', startDate: '2026-11-01' };
  it('normalises the code and applies the defaults', () => {
    expect(createProjectRequestSchema.parse(valid)).toMatchObject({
      code: 'WEB-1',
      status: 'planned',
      priority: 'normal',
      isBillable: true,
    });
  });
  it.each([
    ['a short code', { code: 'A' }],
    ['a long code', { code: 'ABCDEFGHIJKLM' }],
    ['a code with spaces', { code: 'WE B' }],
    ['a code starting with a dash', { code: '-WEB' }],
    ['no name', { name: ' ' }],
    ['an unknown status', { status: 'cancelled' }],
    ['a negative budget', { budgetHours: -1 }],
    ['a budget in odd fractions', { budgetHours: 10.3 }],
    ['an end before the start', { endDate: '2026-10-01' }],
    ['a bad date', { startDate: '1.11.2026' }],
    ['a bad client id', { clientId: 'nope' }],
    ['extra fields', { health: 'on_track' }],
  ])('refuses %s', (_label, patch) => {
    expect(createProjectRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it('accepts an end on the start day and half-hour budgets', () => {
    expect(
      createProjectRequestSchema.safeParse({ ...valid, endDate: '2026-11-01', budgetHours: 120.5 })
        .success,
    ).toBe(true);
  });
  it('updates partially, clears with null, and checks dates when both are given', () => {
    expect(
      updateProjectRequestSchema.parse({ clientId: null, endDate: null, description: ' ' }),
    ).toEqual({
      clientId: null,
      endDate: null,
      description: null,
    });
    for (const body of [
      {},
      { startDate: '2026-11-05', endDate: '2026-11-01' },
      { code: '!' },
      { leadEmployeeId: 'x' },
    ]) {
      expect(updateProjectRequestSchema.safeParse(body).success).toBe(false);
    }
  });
  it('lists with defaults and bounded pages', () => {
    expect(projectQuerySchema.parse({})).toMatchObject({ status: 'all', page: 1, pageSize: 25 });
    expect(projectQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(projectQuerySchema.safeParse({ status: 'x' }).success).toBe(false);
  });
});

describe('milestone and assignment requests', () => {
  it('milestones need a title and a date', () => {
    expect(
      createMilestoneRequestSchema.safeParse({ title: 'Beta', dueDate: '2026-12-01' }).success,
    ).toBe(true);
    for (const body of [
      { title: 'Beta' },
      { dueDate: '2026-12-01' },
      { title: ' ', dueDate: '2026-12-01' },
    ]) {
      expect(createMilestoneRequestSchema.safeParse(body).success).toBe(false);
    }
  });
  const assignment = { employeeId: ID, allocationPct: 50, fromDate: '2026-11-01' };
  it('assignments need a person, an allocation of 1 to 100 and ordered dates', () => {
    expect(
      createAssignmentRequestSchema.safeParse({
        ...assignment,
        toDate: '2026-11-01',
        role: ' Dev ',
      }).success,
    ).toBe(true);
    for (const patch of [
      { allocationPct: 0 },
      { allocationPct: 101 },
      { allocationPct: 12.5 },
      { toDate: '2026-10-31' },
      { employeeId: 'x' },
      { role: 'x'.repeat(61) },
    ]) {
      expect(createAssignmentRequestSchema.safeParse({ ...assignment, ...patch }).success).toBe(
        false,
      );
    }
    expect(updateAssignmentRequestSchema.safeParse({ toDate: null }).success).toBe(true);
    expect(updateAssignmentRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateAssignmentRequestSchema.safeParse({ fromDate: '2026-11-05', toDate: '2026-11-01' })
        .success,
    ).toBe(false);
  });
});
