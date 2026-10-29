import { describe, expect, it } from 'vitest';
import { timeWeekChart } from './time-week-chart.js';

const days = [
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
].map((date) => ({ date }));
const p1 = { id: '0192f5a0-0000-7000-8000-000000000001', code: 'WEB', name: 'Website' };
const p2 = { id: '0192f5a0-0000-7000-8000-000000000002', code: 'OPS', name: 'Operations' };
const entry = (workDate: string, minutes: number | null, isBillable: boolean, project = p1) => ({
  workDate,
  minutes,
  isBillable,
  project,
});

describe('timeWeekChart', () => {
  it('splits each day into billable and not billable and adds up the week', () => {
    const chart = timeWeekChart({
      days,
      entries: [
        entry('2026-10-26', 300, true),
        entry('2026-10-26', 60, false),
        entry('2026-10-27', 480, true, p2),
      ],
    });
    expect(chart.days[0]).toMatchObject({
      billable: 300,
      nonBillable: 60,
      total: 360,
      target: 480,
    });
    expect(chart.days[1]).toMatchObject({ billable: 480, total: 480 });
    expect(chart).toMatchObject({ billable: 780, nonBillable: 60, total: 840, sharePercent: 93 });
  });

  it('groups by project, biggest first, ties by code', () => {
    const chart = timeWeekChart({
      days,
      entries: [
        entry('2026-10-26', 120, true, p1),
        entry('2026-10-27', 120, false, p2),
        entry('2026-10-28', 60, true, p2),
      ],
    });
    expect(chart.projects.map((p) => [p.code, p.billable, p.nonBillable])).toEqual([
      ['OPS', 60, 120],
      ['WEB', 120, 0],
    ]);
  });

  it('gives weekend days no target and keeps weekend work', () => {
    const chart = timeWeekChart({ days, entries: [entry('2026-10-31', 90, true)] });
    expect(chart.days[5]).toMatchObject({ target: 0, total: 90 });
  });

  it('scales to the 8-hour day, or up to the next whole hour for a longer day', () => {
    expect(timeWeekChart({ days, entries: [] }).scale).toBe(480);
    expect(timeWeekChart({ days, entries: [entry('2026-10-26', 479, true)] }).scale).toBe(480);
    expect(timeWeekChart({ days, entries: [entry('2026-10-26', 541, true)] }).scale).toBe(600);
    expect(timeWeekChart({ days, entries: [entry('2026-10-26', 600, true)] }).scale).toBe(600);
  });

  it('shows an empty week as zeros, not NaN', () => {
    const chart = timeWeekChart({ days, entries: [] });
    expect(chart).toMatchObject({
      total: 0,
      billable: 0,
      nonBillable: 0,
      sharePercent: 0,
      projects: [],
    });
  });

  it('ignores a running timer, empty or negative minutes and days outside the week', () => {
    const chart = timeWeekChart({
      days,
      entries: [
        entry('2026-10-26', null, true),
        entry('2026-10-26', 0, true),
        entry('2026-10-26', -5, true),
        entry('2026-11-09', 60, true),
      ],
    });
    expect(chart.total).toBe(0);
    expect(chart.projects).toEqual([]);
  });

  it('rounds the billable share to a whole percent', () => {
    const chart = timeWeekChart({
      days,
      entries: [entry('2026-10-26', 1, true), entry('2026-10-26', 2, false)],
    });
    expect(chart.sharePercent).toBe(33);
  });
});
