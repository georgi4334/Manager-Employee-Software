import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { milestonePosition } from '@/shared/lib/milestone-position';

export type MilestoneState = 'done' | 'late' | 'next' | 'upcoming';

export interface MilestonePoint {
  key: string;
  label: string;
  /** YYYY-MM-DD. */
  date: string;
  state: MilestoneState;
  /** A short extra line (e.g. "11 days late"). */
  note?: string;
}

const DOT: Record<MilestoneState, string> = {
  done: 'border-success bg-success',
  late: 'border-danger bg-surface',
  next: 'border-primary bg-surface',
  upcoming: 'border-border bg-surface',
};

/** At most this many points sit side by side; longer tracks are always a vertical list. */
const MAX_ACROSS = 6;

/**
 * Dated points (milestones, cycle deadlines) on an evenly spaced line with a Today pin (ADR 0033). The pin moves with
 * the days between its two neighbours, so the picture says "between these two" rather than an exact scale. Side by
 * side from `sm` up to six points, otherwise a vertical list (always on phones). Every point writes its label, date
 * and state, so the line and the pin are decoration.
 */
export function MilestoneTrack({
  points,
  today,
  label,
  className,
}: {
  /** Sorted by date. */
  points: readonly MilestonePoint[];
  today: string;
  label: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation('common');
  const language = i18n.resolvedLanguage ?? 'en';
  if (points.length === 0) return null;
  const across = points.length <= MAX_ACROSS;
  const n = points.length;
  const position = milestonePosition(
    points.map((p) => p.date),
    today,
  );
  // The line runs between the centres of the first and the last cell; positions are measured along it.
  const inset = 50 / n;
  const along = (value: number) => `calc(${inset}% + ${(value / 100) * (100 - 2 * inset)}%)`;
  const vars = {
    '--start': `${inset}%`,
    '--span': `${100 - 2 * inset}%`,
    '--done': `${(position / 100) * (100 - 2 * inset)}%`,
    '--pos': along(position),
  } as CSSProperties;

  return (
    <div className={cn('relative', across && 'sm:pt-8', className)} style={vars}>
      {/* the line and its filled part: vertical by default, across from sm when it fits */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[11px] top-[var(--start)] h-[var(--span)] w-1 rounded-full bg-secondary',
          across && 'sm:left-[var(--start)] sm:top-[11px] sm:h-1 sm:w-[var(--span)]',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[11px] top-[var(--start)] h-[var(--done)] w-1 rounded-full bg-brand',
          across && 'sm:left-[var(--start)] sm:top-[11px] sm:h-1 sm:w-[var(--done)]',
        )}
      />
      <span
        aria-hidden="true"
        data-testid="milestone-today"
        className={cn(
          'absolute inset-x-0 top-[var(--pos)] z-10 flex -translate-y-1/2 items-center gap-1.5',
          across &&
            'sm:right-auto sm:top-0 sm:left-[var(--pos)] sm:-translate-x-1/2 sm:translate-y-0 sm:flex-col sm:gap-0',
        )}
      >
        <span
          className={cn(
            'h-px flex-1 border-t border-dashed border-foreground/60',
            across &&
              'sm:order-2 sm:h-12 sm:flex-none sm:border-l-2 sm:border-t-0 sm:border-solid sm:border-foreground',
          )}
        />
        <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
          {t('today')}
        </span>
      </span>
      <ol
        aria-label={label}
        className={cn('grid auto-rows-fr', across && 'sm:grid-flow-col sm:auto-cols-fr')}
      >
        {points.map((p) => (
          <li
            key={p.key}
            className={cn(
              'relative flex min-h-12 min-w-0 items-center gap-3 pl-9',
              across && 'sm:min-h-0 sm:flex-col sm:items-center sm:gap-1 sm:px-1 sm:pl-1 sm:pt-8',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-[3px] top-1/2 size-5 -translate-y-1/2 rounded-full border-[3px]',
                across && 'sm:left-1/2 sm:top-0 sm:-translate-x-1/2 sm:translate-y-[3px]',
                DOT[p.state],
              )}
            />
            <span
              className={cn('min-w-0 text-sm leading-snug', across && 'sm:w-full sm:text-center')}
            >
              <span
                className={cn(
                  'block break-words font-semibold',
                  p.state === 'late' && 'text-danger',
                )}
              >
                {p.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatDay(p.date, language)}
                <span className="sr-only">
                  {' · '}
                  {t(`milestone.${p.state}`)}
                </span>
              </span>
              {p.note && <span className="block text-xs font-medium text-danger">{p.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
