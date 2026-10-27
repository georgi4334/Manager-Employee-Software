import { useEffect, useState } from 'react';

/** Minutes after midnight in a time zone. */
export function minutesIn(timeZone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** The current time of day in the workspace time zone, refreshed every 30 seconds. */
export function useNowMinutes(timeZone: string): number {
  const [now, setNow] = useState(() => minutesIn(timeZone));
  useEffect(() => {
    const timer = setInterval(() => setNow(minutesIn(timeZone)), 30_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return now;
}
