import { WORKDAY_MINUTES, attendanceProgress, type AttendanceDayLevel } from '@intime/contracts';
import { AlertTriangle, CheckCircle2, Clock, TrendingUp, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useDuration } from './RecordRow';

const LEVEL_STYLE: Record<AttendanceDayLevel, { bar: string; pill: string; icon: typeof Clock }> = {
  in_progress: {
    bar: 'bg-primary',
    pill: 'border-primary/40 bg-accent text-accent-foreground',
    icon: Clock,
  },
  short: { bar: 'bg-danger', pill: 'border-danger/40 text-danger', icon: AlertTriangle },
  almost: { bar: 'bg-warning', pill: 'border-warning/40 text-warning', icon: TriangleAlert },
  complete: { bar: 'bg-success', pill: 'border-success/40 text-success', icon: CheckCircle2 },
  over: { bar: 'bg-danger', pill: 'border-danger/40 text-danger', icon: TrendingUp },
};

/** The day's state in words with an icon; colour is never the only signal. */
export function LevelPill({ level }: { level: AttendanceDayLevel }) {
  const { t } = useTranslation('attendance');
  const { pill, icon: Icon } = LEVEL_STYLE[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border bg-surface px-2.5 py-0.5 text-xs font-semibold',
        pill,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`level.${level}`)}
    </span>
  );
}

/**
 * An 8-hour line filled by the recorded time, one faint tick per hour. Decoration only: the
 * minutes, the target and the level are written next to it.
 */
export function ProgressLine({
  minutes,
  level,
  target = WORKDAY_MINUTES,
  className,
}: {
  minutes: number;
  level: AttendanceDayLevel;
  /** 0 on a weekend: the line only shows that time was recorded on a day off. */
  target?: number;
  className?: string;
}) {
  const { t } = useTranslation('attendance');
  const duration = useDuration();
  const over = minutes - target;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        aria-hidden="true"
        className="relative h-2.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            LEVEL_STYLE[level].bar,
          )}
          style={{ width: `${attendanceProgress(minutes, target) * 100}%` }}
        />
        <div className="absolute inset-0 grid grid-cols-8">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="border-r border-surface/70" />
          ))}
        </div>
      </div>
      <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          {target === 0
            ? t('dayOff', { duration: duration(minutes) })
            : t('progress', { done: duration(minutes), target: duration(target) })}
        </span>
        {level === 'over' && target > 0 && (
          <span className="font-medium text-danger">
            {t('overBy', { duration: duration(over) })}
          </span>
        )}
        {(level === 'short' || level === 'almost') && (
          <span>{t('missing', { duration: duration(-over) })}</span>
        )}
      </p>
    </div>
  );
}

const SUMMARY_ORDER: AttendanceDayLevel[] = ['complete', 'almost', 'short', 'over', 'in_progress'];

/** How many days of the period reached each level; levels with no days are left out. */
export function LevelSummary({ days }: { days: readonly { level: AttendanceDayLevel }[] }) {
  const { t } = useTranslation('attendance');
  const counts = SUMMARY_ORDER.map((level) => ({
    level,
    count: days.filter((d) => d.level === level).length,
  })).filter((c) => c.count > 0);
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('summary.label')}>
      {counts.map(({ level, count }) => (
        <li key={level} className="flex items-center gap-1.5">
          <LevelPill level={level} />
          <span className="text-sm font-semibold tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}
