import { describe, expect, it } from 'vitest';
import {
  COMPARE_TOLERANCE_MINUTES,
  compareDay,
  compareQuerySchema,
  leaveConflictsSchema,
  reminderDue,
} from './integrations.js';

const day = (o: Partial<Parameters<typeof compareDay>[0]> = {}) =>
  compareDay({
    attendanceMinutes: 480,
    loggedMinutes: 480,
    onLeave: false,
    openRecord: false,
    ...o,
  });

describe('compareDay', () => {
  it('has nothing to say when presence and logged time agree', () => {
    expect(day()).toBe('none');
    expect(day({ loggedMinutes: 450 })).toBe('none');
    expect(day({ loggedMinutes: 510 })).toBe('none');
  });
  it('flags a difference above the tolerance, and only above it', () => {
    expect(COMPARE_TOLERANCE_MINUTES).toBe(30);
    expect(day({ loggedMinutes: 480 + 30 })).toBe('none'); // exactly the tolerance
    expect(day({ loggedMinutes: 480 + 31 })).toBe('more_logged');
    expect(day({ loggedMinutes: 480 - 30 })).toBe('none');
    expect(day({ loggedMinutes: 480 - 31 })).toBe('less_logged');
  });
  it('flags logged time without any presence, and presence without logged time', () => {
    expect(day({ attendanceMinutes: 0, loggedMinutes: 60 })).toBe('more_logged');
    expect(day({ attendanceMinutes: 30, loggedMinutes: 0 })).toBe('none'); // within tolerance
    expect(day({ attendanceMinutes: 60, loggedMinutes: 0 })).toBe('less_logged');
    expect(day({ attendanceMinutes: 480, loggedMinutes: 0 })).toBe('less_logged');
  });
  it('never flags an empty day, leave, or a record that is still open', () => {
    expect(day({ attendanceMinutes: 0, loggedMinutes: 0 })).toBe('none');
    expect(day({ attendanceMinutes: 0, loggedMinutes: 480, onLeave: true })).toBe('none');
    expect(day({ attendanceMinutes: 480, loggedMinutes: 0, onLeave: true })).toBe('none');
    expect(day({ attendanceMinutes: 0, loggedMinutes: 480, openRecord: true })).toBe('none');
  });
});

describe('reminderDue', () => {
  const start = new Date('2026-10-26T08:00:00Z');
  it('is due exactly at the threshold and not a moment before', () => {
    expect(reminderDue(start, new Date('2026-10-26T19:59:59Z'), 12)).toBe(false);
    expect(reminderDue(start, new Date('2026-10-26T20:00:00Z'), 12)).toBe(true);
    expect(reminderDue(start, new Date('2026-10-27T08:00:00Z'), 12)).toBe(true);
  });
  it('is not due for something that starts in the future', () => {
    expect(reminderDue(new Date('2026-10-27T00:00:00Z'), start, 10)).toBe(false);
  });
});

describe('schemas', () => {
  it('reads the compare query', () => {
    expect(compareQuerySchema.safeParse({}).success).toBe(true);
    expect(compareQuerySchema.safeParse({ weekStart: '2026-10-26' }).success).toBe(true);
    expect(compareQuerySchema.safeParse({ weekStart: 'x' }).success).toBe(false);
    expect(compareQuerySchema.safeParse({ employeeId: 'x' }).success).toBe(false);
  });
  it('accepts empty conflicts', () => {
    expect(
      leaveConflictsSchema.safeParse({ assignments: [], milestones: [], tasks: [] }).success,
    ).toBe(true);
  });
});
