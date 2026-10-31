import type { AttendanceDayLevel } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { ProgressText } from './DayProgress';
import { useDuration } from './RecordRow';
import { clockTime, dayRibbon, type RibbonRecord } from './ribbon';

/**
 * One day on a clock (ADR 0033): blocks where the person worked, dashed breaks, a Now line while a record is open
 * and a dotted marker where the target is (or will be) reached. Decoration: the line under it says the totals, the
 * breaks and the target time in words, and the records list the exact times.
 */
export function DayRibbon({
  records,
  minutes,
  target,
  level,
}: {
  records: readonly RibbonRecord[];
  minutes: number;
  target: number;
  level: AttendanceDayLevel;
}) {
  const { t } = useTranslation('attendance');
  const duration = useDuration();
  const r = dayRibbon(records, minutes, target);
  const start = r.startHour * 60;
  const span = (r.endHour - r.startHour) * 60;
  const at = (minute: number) => ((minute - start) / span) * 100;
  const hours = r.endHour - r.startHour;
  const step = hours > 14 ? 3 : 2;
  const labels = Array.from({ length: hours + 1 }, (_, i) => r.startHour + i).filter(
    (h) => (h - r.startHour) % step === 0 || h === r.endHour,
  );
  const extra: string[] = [];
  if (r.breakMinutes > 0) extra.push(t('ribbon.breaks', { duration: duration(r.breakMinutes) }));
  if (r.targetAt !== null) {
    extra.push(
      t(r.targetProjected ? 'ribbon.targetBy' : 'ribbon.targetAt', {
        target: duration(target),
        time: clockTime(r.targetAt),
      }),
    );
  }
  const nowPct = r.now === null ? null : at(r.now);

  return (
    <div className="space-y-1.5">
      <div
        aria-hidden="true"
        data-testid="day-ribbon"
        className={cn('relative', nowPct !== null && 'pt-6')}
      >
        <div className="relative h-8 overflow-hidden rounded-lg bg-secondary">
          {Array.from({ length: hours - 1 }, (_, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-l border-border"
              style={{ left: `${((i + 1) / hours) * 100}%` }}
            />
          ))}
          {r.blocks.map((b, i) => {
            const previous = r.blocks[i - 1];
            return (
              <span key={`${b.from}-${b.to}`}>
                {previous && b.from > previous.to && (
                  <span
                    className="absolute top-1/2 border-t-2 border-dashed border-muted-foreground"
                    style={{
                      left: `${at(previous.to)}%`,
                      width: `${at(b.from) - at(previous.to)}%`,
                    }}
                  />
                )}
                <span
                  className={cn(
                    'absolute inset-y-1 min-w-1 bg-brand',
                    b.open
                      ? 'rounded-l-md bg-linear-to-r from-brand from-60% to-brand/30'
                      : 'rounded-md',
                  )}
                  style={{ left: `${at(b.from)}%`, width: `${at(b.to) - at(b.from)}%` }}
                />
              </span>
            );
          })}
          {r.targetAt !== null && (
            <span
              className={cn(
                'absolute inset-y-0 border-l-2 border-success',
                r.targetProjected ? 'border-dotted' : 'border-solid',
              )}
              style={{ left: `${at(r.targetAt)}%` }}
            />
          )}
        </div>
        {nowPct !== null && r.now !== null && (
          <span
            className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-foreground"
            style={{ left: `${nowPct}%` }}
          >
            <span
              className={cn(
                'absolute top-0 whitespace-nowrap text-xs font-semibold',
                nowPct > 70 ? 'right-2' : 'left-2',
              )}
            >
              {t('ribbon.now', { time: clockTime(r.now) })}
            </span>
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        className="relative h-4 text-[0.6875rem] tabular-nums text-muted-foreground"
      >
        {labels.map((h) => (
          <span
            key={h}
            className={cn(
              'absolute top-0',
              h === r.startHour ? 'left-0' : h === r.endHour ? 'right-0' : '-translate-x-1/2',
            )}
            style={h === r.startHour || h === r.endHour ? undefined : { left: `${at(h * 60)}%` }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <ProgressText minutes={minutes} level={level} target={target} extra={extra} />
    </div>
  );
}
