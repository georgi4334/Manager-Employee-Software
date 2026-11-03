import { describe, expect, it } from 'vitest';
import { event, leave, reported, review, sheet, step, uuid } from '@/tests/inbox-fixtures';
import { buildInbox, countByKind, inboxSources } from './use-inbox';

describe('inboxSources', () => {
  it('asks only for what the permissions allow', () => {
    expect(inboxSources(undefined)).toEqual({
      leave: false,
      timesheet: false,
      reviewMine: false,
      reviewTeam: false,
      feedback: false,
      invitation: false,
      checklist: true,
    });
    expect(
      inboxSources({
        'leave.approve': 'reports',
        'timesheet.approve': 'reports',
        'review.view': 'own',
        'feedback.moderate': 'all',
        'calendar.manage_own': 'own',
      }),
    ).toEqual({
      leave: true,
      timesheet: true,
      reviewMine: true,
      reviewTeam: false,
      feedback: true,
      invitation: true,
      checklist: true,
    });
  });

  it('reads the team reviews only at scope reports or all', () => {
    expect(inboxSources({ 'review.view': 'reports' }).reviewTeam).toBe(true);
    expect(inboxSources({ 'review.view': 'all' }).reviewTeam).toBe(true);
    expect(inboxSources({ 'review.view': 'team' }).reviewTeam).toBe(false);
  });
});

describe('buildInbox', () => {
  it('is empty without lists', () => {
    expect(buildInbox({})).toEqual([]);
  });

  it('keeps only pending leave the user may decide, oldest first', () => {
    const items = buildInbox({
      leave: [
        leave(1, { createdAt: '2026-10-31T08:00:00Z' }),
        leave(2, { createdAt: '2026-10-20T08:00:00Z' }),
        leave(3, { canApprove: false }),
        leave(4, { status: 'approved' }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([`leave:${uuid(102)}`, `leave:${uuid(101)}`]);
  });

  it('keeps only submitted weeks the user may decide (never their own)', () => {
    const items = buildInbox({
      sheets: [
        sheet(1, { submittedAt: '2026-11-01T08:00:00Z' }),
        sheet(2, { submittedAt: '2026-10-25T08:00:00Z' }),
        sheet(3, { canDecide: false }),
        sheet(4, { status: 'approved' }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([`sheet:${uuid(202)}`, `sheet:${uuid(201)}`]);
  });

  it('lists unsubmitted review parts of open cycles, late ones first', () => {
    const items = buildInbox({
      mine: [
        review(1),
        review(2, { selfSubmitted: true }),
        review(3, { cycle: { id: uuid(3), name: 'Draft', status: 'calibration' } }),
      ],
      team: [
        review(4, { managerSubmitted: false, managerOverdue: true }),
        review(5, { managerSubmitted: true }),
        review(6, { managerSubmitted: null }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([
      `review:manager:${uuid(304)}`,
      `review:self:${uuid(301)}`,
    ]);
    expect(items[0]).toMatchObject({ part: 'manager', late: true });
    expect(items[1]).toMatchObject({ part: 'self', late: false });
  });

  it('lists open checklist steps by due date', () => {
    const items = buildInbox({
      steps: [
        step(1, { dueDate: '2026-11-20' }),
        step(2, { dueDate: '2026-11-03' }),
        step(3, { done: true }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([`step:${uuid(602)}`, `step:${uuid(601)}`]);
  });

  it('lists only open reports', () => {
    const items = buildInbox({
      reported: [reported(1), reported(2, { report: 'kept' }), reported(3, { report: 'none' })],
    });
    expect(items.map((i) => i.key)).toEqual([`feedback:${uuid(401)}`]);
  });

  it('lists unanswered invitations once per event, by date', () => {
    const items = buildInbox({
      events: [
        event(1, { occurrenceDate: '2026-11-12' }),
        event(2, { occurrenceDate: '2026-11-04' }),
        event(2, { occurrenceDate: '2026-11-11' }),
        event(3, { myResponse: 'accepted' }),
        event(4, { myResponse: null }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([`event:${uuid(502)}`, `event:${uuid(501)}`]);
    expect(items[0]).toMatchObject({ event: { occurrenceDate: '2026-11-04' } });
  });

  it('groups in a fixed order and counts per kind', () => {
    const items = buildInbox({
      events: [event(1)],
      reported: [reported(1)],
      mine: [review(1)],
      sheets: [sheet(1)],
      leave: [leave(1), leave(2)],
    });
    expect(items.map((i) => i.kind)).toEqual([
      'leave',
      'leave',
      'timesheet',
      'review',
      'feedback',
      'invitation',
    ]);
    expect(countByKind(items)).toEqual({
      leave: 2,
      timesheet: 1,
      review: 1,
      feedback: 1,
      invitation: 1,
      checklist: 0,
    });
  });
});
