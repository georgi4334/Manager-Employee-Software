import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

export type ProgressTone = 'primary' | 'success' | 'danger' | 'muted';

const FILL: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

/** The percentage is also written out, so the bar is never the only carrier of the information. */
export function ProgressBar({
  pct,
  label,
  tone = 'primary',
  large,
}: {
  pct: number;
  label: string;
  tone?: ProgressTone;
  /** A thicker bar and a bigger number, for the list. */
  large?: boolean;
}) {
  const { t } = useTranslation('goals');
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={cn('flex-1 overflow-hidden rounded-full bg-secondary', large ? 'h-3' : 'h-2')}
      >
        <div
          className={cn('h-full rounded-full', FILL[tone])}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span
        className={cn(
          'text-right tabular-nums',
          large ? 'w-16 whitespace-nowrap text-lg font-semibold' : 'w-12 text-sm',
        )}
      >
        {t('percent', { pct })}
      </span>
    </div>
  );
}
