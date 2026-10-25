import { useTranslation } from 'react-i18next';

/** The percentage is also written out, so the bar is never the only carrier of the information. */
export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const { t } = useTranslation('goals');
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right text-sm tabular-nums">{t('percent', { pct })}</span>
    </div>
  );
}
