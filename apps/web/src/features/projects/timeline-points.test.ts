import { describe, expect, it } from 'vitest';
import { timelinePoints } from './Timeline';

const text = { start: 'Start', end: 'End', late: (days: number) => `${days} days late` };
const milestone = (
  id: string,
  dueDate: string,
  extra: { status?: 'open' | 'done'; overdueDays?: number } = {},
) => ({
  id,
  title: `M ${id}`,
  dueDate,
  status: extra.status ?? ('open' as const),
  doneOn: null,
  overdueDays: extra.overdueDays ?? 0,
});

describe('timelinePoints', () => {
  it('orders start, milestones by date and end, and marks the first open future point as next', () => {
    const points = timelinePoints(
      {
        startDate: '2026-09-01',
        endDate: '2026-12-12',
        milestones: [
          milestone('b', '2026-11-18'),
          milestone('a', '2026-09-26', { status: 'done' }),
          milestone('c', '2026-10-20', { overdueDays: 11 }),
        ],
      },
      '2026-10-31',
      text,
    );
    expect(points.map((p) => [p.key, p.state])).toEqual([
      ['start', 'done'],
      ['a', 'done'],
      ['c', 'late'],
      ['b', 'next'],
      ['end', 'upcoming'],
    ]);
    expect(points[2]!.note).toBe('11 days late');
  });

  it('has no end point without an end date and no next point when everything has passed', () => {
    const open = timelinePoints(
      { startDate: '2026-01-01', endDate: null, milestones: [] },
      '2026-02-01',
      text,
    );
    expect(open.map((p) => p.key)).toEqual(['start']);
    const ended = timelinePoints(
      { startDate: '2026-01-01', endDate: '2026-02-01', milestones: [] },
      '2026-03-01',
      text,
    );
    expect(ended.map((p) => p.state)).toEqual(['done', 'done']);
  });

  it('marks the start as next before the project begins', () => {
    const points = timelinePoints(
      { startDate: '2027-01-01', endDate: '2027-02-01', milestones: [] },
      '2026-10-31',
      text,
    );
    expect(points.map((p) => p.state)).toEqual(['next', 'upcoming']);
  });
});
