import type { AttendanceDay } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/shared/lib/format';
import { LevelPill } from './DayProgress';
import { DayRibbon } from './DayRibbon';
import { RecordRow, useDuration } from './RecordRow';

const initials = (p: { firstName: string; lastName: string }) =>
  `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();

/** One person's day: total, an 8-hour progress line and the records of the day. */
export function DayCard({ day, showEmployee }: { day: AttendanceDay; showEmployee?: boolean }) {
  const { t, i18n } = useTranslation('attendance');
  const language = i18n.resolvedLanguage ?? 'en';
  const duration = useDuration();
  const name = `${day.employee.firstName} ${day.employee.lastName}`;
  const date = formatDay(day.date, language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <li className="rounded-xl glass p-4">
      <article aria-label={showEmployee ? `${name}, ${date}` : date} className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {showEmployee && (
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
            >
              {initials(day.employee)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{showEmployee ? name : date}</p>
            {showEmployee && <p className="text-sm text-muted-foreground">{date}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{duration(day.minutes)}</span>
            <LevelPill level={day.level} />
          </div>
        </div>
        <DayRibbon
          records={day.records}
          minutes={day.minutes}
          level={day.level}
          target={day.target}
        />
        <ul className="divide-y divide-border border-t border-border" aria-label={t('day.records')}>
          {day.records.map((record) => (
            <RecordRow key={record.id} record={record} />
          ))}
        </ul>
      </article>
    </li>
  );
}
