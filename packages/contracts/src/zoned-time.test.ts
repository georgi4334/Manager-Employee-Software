import { describe, expect, it } from 'vitest';
import { minutesBetween, utcToZoned, zonedToUtc } from './zoned-time.js';

describe('utcToZoned', () => {
  it('shows the local date and time, which can differ from UTC', () => {
    expect(utcToZoned('2026-10-24T22:30:00Z', 'UTC')).toEqual({
      date: '2026-10-24',
      time: '22:30',
    });
    expect(utcToZoned('2026-10-24T22:30:00Z', 'Europe/Sofia')).toEqual({
      date: '2026-10-25',
      time: '01:30',
    });
    expect(utcToZoned('2026-10-24T22:30:00Z', 'America/Los_Angeles')).toEqual({
      date: '2026-10-24',
      time: '15:30',
    });
  });

  it('writes midnight as 00:00, not 24:00', () => {
    expect(utcToZoned('2026-01-01T00:00:00Z', 'UTC')).toEqual({
      date: '2026-01-01',
      time: '00:00',
    });
    expect(utcToZoned('2025-12-31T22:00:00Z', 'Europe/Sofia')).toEqual({
      date: '2026-01-01',
      time: '00:00',
    });
  });

  it('accepts dates, strings and numbers', () => {
    const ms = Date.parse('2026-06-01T10:00:00Z');
    expect(utcToZoned(new Date(ms), 'UTC').time).toBe('10:00');
    expect(utcToZoned(ms, 'UTC').time).toBe('10:00');
  });
});

describe('zonedToUtc', () => {
  it('converts winter and summer time of Sofia (UTC+2 / UTC+3)', () => {
    expect(zonedToUtc('2026-01-15', '09:00', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-01-15T07:00:00.000Z',
    );
    expect(zonedToUtc('2026-07-15', '09:00', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-07-15T06:00:00.000Z',
    );
    expect(zonedToUtc('2026-07-15', '09:00', 'UTC')?.toISOString()).toBe(
      '2026-07-15T09:00:00.000Z',
    );
    expect(zonedToUtc('2026-07-15', '09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('round-trips every quarter hour of the days around the clock changes of 2026', () => {
    for (const zone of ['Europe/Sofia', 'Europe/Berlin', 'America/New_York']) {
      for (const day of [
        '2026-03-28',
        '2026-03-29',
        '2026-03-30',
        '2026-10-24',
        '2026-10-25',
        '2026-10-26',
        '2026-03-08',
        '2026-11-01',
      ]) {
        for (let minute = 0; minute < 24 * 60; minute += 15) {
          const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
          const instant = zonedToUtc(day, time, zone);
          if (instant)
            expect(utcToZoned(instant, zone), `${zone} ${day} ${time}`).toEqual({
              date: day,
              time,
            });
        }
      }
    }
  });

  it('has no instant for a time that is skipped when the clocks go forward (Sofia, 29 March 2026)', () => {
    expect(zonedToUtc('2026-03-29', '03:30', 'Europe/Sofia')).toBeNull();
    expect(zonedToUtc('2026-03-29', '02:59', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-03-29T00:59:00.000Z',
    );
    expect(zonedToUtc('2026-03-29', '04:00', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    );
  });

  it('takes the first instant of a time that happens twice when the clocks go back (Sofia, 25 October 2026)', () => {
    // 03:30 occurs at 00:30Z (summer time) and again at 01:30Z (winter time)
    expect(zonedToUtc('2026-10-25', '03:30', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(zonedToUtc('2026-10-25', '02:30', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    );
    expect(zonedToUtc('2026-10-25', '04:30', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-10-25T02:30:00.000Z',
    );
  });

  it('handles the end of the year and leap days', () => {
    expect(zonedToUtc('2026-12-31', '23:59', 'Europe/Sofia')?.toISOString()).toBe(
      '2026-12-31T21:59:00.000Z',
    );
    expect(zonedToUtc('2028-02-29', '12:00', 'UTC')?.toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });
});

describe('minutesBetween', () => {
  it('counts whole minutes, in both directions', () => {
    expect(minutesBetween('2026-10-24T08:00:00Z', '2026-10-24T16:30:00Z')).toBe(510);
    expect(minutesBetween('2026-10-24T08:00:00Z', '2026-10-24T08:00:29Z')).toBe(0);
    expect(minutesBetween('2026-10-24T08:00:00Z', '2026-10-24T07:00:00Z')).toBe(-60);
  });

  it('is exact across a clock change (the day of 25 October 2026 has 25 hours in Sofia)', () => {
    const start = zonedToUtc('2026-10-25', '00:00', 'Europe/Sofia')!;
    const end = zonedToUtc('2026-10-26', '00:00', 'Europe/Sofia')!;
    expect(minutesBetween(start, end)).toBe(25 * 60);
  });
});
