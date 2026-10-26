import { describe, expect, it } from 'vitest';
import { positionPct } from './timelinePosition';

describe('position on the timeline', () => {
  it('maps the start to 0 and the end to 100', () => {
    expect(positionPct('2026-01-01', '2026-01-01', '2026-01-11')).toBe(0);
    expect(positionPct('2026-01-11', '2026-01-01', '2026-01-11')).toBe(100);
    expect(positionPct('2026-01-06', '2026-01-01', '2026-01-11')).toBe(50);
  });
  it('keeps dates outside the span at the edges', () => {
    expect(positionPct('2025-12-01', '2026-01-01', '2026-01-11')).toBe(0);
    expect(positionPct('2027-01-01', '2026-01-01', '2026-01-11')).toBe(100);
  });
  it('copes with a one-day project', () => {
    expect(positionPct('2026-01-01', '2026-01-02', '2026-01-02')).toBe(0);
    expect(positionPct('2026-01-02', '2026-01-02', '2026-01-02')).toBe(100);
    expect(positionPct('2026-01-03', '2026-01-02', '2026-01-02')).toBe(100);
  });
  it('rounds to one decimal', () => {
    expect(positionPct('2026-01-02', '2026-01-01', '2026-01-04')).toBe(33.3);
  });
});
