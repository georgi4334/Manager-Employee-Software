import type { ReviewCycle } from '@intime/contracts';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { cyclePoints } from './CycleCard';

const t = ((key: string) => key) as unknown as TFunction<'reviews'>;
const cycle = (extra: Partial<ReviewCycle> = {}): ReviewCycle => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'H2',
  periodStart: '2026-07-01',
  periodEnd: '2026-12-31',
  selfDue: '2027-01-15',
  managerDue: '2027-01-31',
  status: 'open',
  competencies: [],
  progress: { total: 10, selfSubmitted: 4, managerSubmitted: 0, calibrated: 0, released: 0 },
  canManage: true,
  ...extra,
});

const states = (c: ReviewCycle, today: string) =>
  cyclePoints(c, today, t).map((p) => [p.key, p.state]);

describe('cyclePoints', () => {
  it('lists the dates in order with the next one marked', () => {
    expect(states(cycle(), '2026-10-31')).toEqual([
      ['periodStart', 'done'],
      ['periodEnd', 'next'],
      ['selfDue', 'upcoming'],
      ['managerDue', 'upcoming'],
    ]);
  });

  it('marks a passed deadline late while the cycle is open and parts are missing', () => {
    expect(states(cycle(), '2027-01-20')).toEqual([
      ['periodStart', 'done'],
      ['periodEnd', 'done'],
      ['selfDue', 'late'],
      ['managerDue', 'next'],
    ]);
  });

  it('is never late without the counts, after the open stage, or when everything is in', () => {
    expect(states(cycle({ progress: null }), '2027-01-20')[2]).toEqual(['selfDue', 'done']);
    expect(states(cycle({ status: 'calibration' }), '2027-01-20')[2]).toEqual(['selfDue', 'done']);
    const all = { total: 10, selfSubmitted: 10, managerSubmitted: 10, calibrated: 0, released: 0 };
    expect(states(cycle({ progress: all }), '2027-02-10')).toEqual([
      ['periodStart', 'done'],
      ['periodEnd', 'done'],
      ['selfDue', 'done'],
      ['managerDue', 'done'],
    ]);
  });

  it('shows a closed cycle as done throughout, even with dates ahead', () => {
    expect(
      states(cycle({ status: 'closed' }), '2026-08-01').every(([, state]) => state === 'done'),
    ).toBe(true);
  });
});
