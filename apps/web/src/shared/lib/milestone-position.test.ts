import { describe, expect, it } from 'vitest';
import { milestonePosition } from './milestone-position';

const dates = ['2026-09-01', '2026-09-11', '2026-10-01'];

describe('milestonePosition', () => {
  it('is 0 before and on the first point and 100 on and after the last', () => {
    expect(milestonePosition(dates, '2026-08-01')).toBe(0);
    expect(milestonePosition(dates, '2026-09-01')).toBe(0);
    expect(milestonePosition(dates, '2026-10-01')).toBe(100);
    expect(milestonePosition(dates, '2027-01-01')).toBe(100);
  });

  it('sits on a middle point exactly', () => {
    expect(milestonePosition(dates, '2026-09-11')).toBe(50);
  });

  it('moves with the days inside a gap, not with the calendar overall', () => {
    // 5 of 10 days into the first gap: a quarter of the track.
    expect(milestonePosition(dates, '2026-09-06')).toBe(25);
    // 10 of 20 days into the second gap: three quarters.
    expect(milestonePosition(dates, '2026-09-21')).toBe(75);
  });

  it('handles two points on the same day', () => {
    expect(milestonePosition(['2026-09-01', '2026-09-01', '2026-09-10'], '2026-09-05')).toBe(72.2);
  });

  it('handles fewer than two points', () => {
    expect(milestonePosition([], '2026-09-01')).toBe(0);
    expect(milestonePosition(['2026-09-01'], '2026-08-31')).toBe(0);
    expect(milestonePosition(['2026-09-01'], '2026-09-01')).toBe(100);
  });
});
