import {
  addDays,
  eventReminderDue,
  occurrencesIn,
  todayIn,
  utcToZoned,
  zonedToUtc,
  type RecurrenceFreq,
  type RecurrenceRule,
} from '@intime/contracts';
import type { TenantTx } from '../../../infrastructure/tenancy/tenant-context.js';

/** Events looked at per workspace and run; what is left is picked up by the next run. */
const BATCH = 500;
/** The largest lead is one day, so nothing further ahead can be due. */
const LOOKAHEAD_DAYS = 2;

const day = (date: Date): string => date.toISOString().slice(0, 10);
const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);

export interface Reminder {
  recipientUserId: string;
  eventId: string;
  date: string;
}

/**
 * Event reminders of one workspace (docs/adr/0029-event-reminders.md): for every occurrence whose reminder is
 * due, claim it (unique row, so it is sent once) and hand each recipient to `queue`. Returns how many
 * occurrences were claimed.
 */
export async function remindEvents(
  tx: TenantTx,
  tenantId: string,
  now: Date,
  queue: (reminder: Reminder) => Promise<void>,
): Promise<number> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultTimezone: true },
  });
  const zone = tenant?.defaultTimezone ?? 'UTC';
  const today = todayIn(zone, now);
  const to = addDays(today, LOOKAHEAD_DAYS);

  const events = await tx.calendarEvent.findMany({
    where: {
      reminderMinutes: { not: null },
      startDate: { lte: dateIn(to) },
      OR: [
        { recurrenceFreq: null, endDate: { gte: dateIn(today) } },
        {
          recurrenceFreq: { not: null },
          OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: dateIn(today) } }],
        },
      ],
    },
    select: {
      id: true,
      scope: true,
      allDay: true,
      startDate: true,
      endDate: true,
      startsAt: true,
      recurrenceFreq: true,
      recurrenceInterval: true,
      recurrenceWeekdays: true,
      recurrenceUntil: true,
      recurrenceCount: true,
      reminderMinutes: true,
      exceptions: { select: { originalDate: true } },
      owner: { select: { userId: true, status: true } },
      attendees: {
        where: { response: { not: 'declined' } },
        select: { employee: { select: { userId: true, status: true } } },
      },
      team: {
        select: {
          lead: { select: { userId: true, status: true } },
          members: { select: { employee: { select: { userId: true, status: true } } } },
        },
      },
    },
    orderBy: { startDate: 'asc' },
    take: BATCH,
  });

  let claimed = 0;
  for (const event of events) {
    const lead = event.reminderMinutes!;
    const start = day(event.startDate);
    const length = Math.round((event.endDate.getTime() - event.startDate.getTime()) / 86_400_000);
    const localTime = event.startsAt ? utcToZoned(event.startsAt, zone).time : '00:00';
    const dates = event.recurrenceFreq
      ? occurrencesIn(
          start,
          length,
          {
            freq: event.recurrenceFreq as RecurrenceFreq,
            interval: event.recurrenceInterval,
            weekdays: event.recurrenceWeekdays,
            until: event.recurrenceUntil ? day(event.recurrenceUntil) : null,
            count: event.recurrenceCount,
          } satisfies RecurrenceRule,
          today,
          to,
          new Set(event.exceptions.map((e) => day(e.originalDate))),
        ).map((o) => o.startDate)
      : [start];

    for (const date of dates) {
      // A time that does not exist on that day (clocks go forward) is skipped, never guessed.
      const startsAt = zonedToUtc(date, localTime, zone);
      if (!startsAt || !eventReminderDue(startsAt.getTime(), lead, now.getTime())) continue;
      const claim = await tx.calendarReminder.createMany({
        data: [{ eventId: event.id, occurrenceDate: dateIn(date) }],
        skipDuplicates: true,
      });
      if (claim.count !== 1) continue;
      claimed += 1;

      const people = [
        event.owner,
        ...event.attendees.map((a) => a.employee),
        ...(event.team ? [event.team.lead, ...event.team.members.map((m) => m.employee)] : []),
      ];
      const recipients = new Set(
        people.flatMap((p) => (p && p.userId && p.status === 'active' ? [p.userId] : [])),
      );
      for (const recipientUserId of recipients) {
        await queue({ recipientUserId, eventId: event.id, date });
      }
    }
  }
  return claimed;
}
