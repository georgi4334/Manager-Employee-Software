import { describe, expect, it } from 'vitest';
import { clockTime, dayRibbon, type RibbonRecord } from './ribbon';

const closed = (startTime: string, endTime: string, minutes: number): RibbonRecord => ({
  startTime,
  endTime,
  open: false,
  minutes,
});
const open = (startTime: string): RibbonRecord => ({
  startTime,
  endTime: null,
  open: true,
  minutes: null,
});

describe('dayRibbon', () => {
  it('places closed records on the clock and sums the breaks between them', () => {
    const r = dayRibbon([closed('12:48', '17:00', 252), closed('08:12', '12:12', 240)], 492, 480);
    expect(r.blocks).toEqual([
      { from: 492, to: 732, open: false },
      { from: 768, to: 1020, open: false },
    ]);
    expect(r.breakMinutes).toBe(36);
    expect(r.now).toBeNull();
    expect(clockTime(r.targetAt!)).toBe('16:48');
    expect(r.targetProjected).toBe(false);
    expect([r.startHour, r.endHour]).toEqual([7, 19]);
  });

  it('runs an open record to the total and projects when the target will be reached', () => {
    const r = dayRibbon([closed('08:12', '12:12', 240), open('12:48')], 340, 480);
    expect(r.blocks[1]).toEqual({ from: 768, to: 868, open: true });
    expect(clockTime(r.now!)).toBe('14:28');
    expect(clockTime(r.targetAt!)).toBe('16:48');
    expect(r.targetProjected).toBe(true);
  });

  it('has no target time for a short finished day or a day without a target', () => {
    expect(dayRibbon([closed('09:00', '12:00', 180)], 180, 480).targetAt).toBeNull();
    expect(dayRibbon([closed('09:00', '18:00', 540)], 540, 0).targetAt).toBeNull();
  });

  it('widens the clock for early and late work and cuts at midnight', () => {
    const r = dayRibbon([closed('05:30', '06:30', 60), closed('20:00', '01:00', 300)], 360, 480);
    expect(r.startHour).toBe(5);
    expect(r.endHour).toBe(24);
    expect(r.blocks[1]).toEqual({ from: 1200, to: 1440, open: false });
  });

  it('shows the default day when there are no records', () => {
    const r = dayRibbon([], 0, 480);
    expect([r.startHour, r.endHour, r.blocks.length, r.targetAt]).toEqual([7, 19, 0, null]);
  });
});

describe('clockTime', () => {
  it('formats minutes of the day and wraps', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(1008)).toBe('16:48');
    expect(clockTime(1440 + 5)).toBe('00:05');
  });
});
