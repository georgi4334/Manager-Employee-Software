import { useTranslation } from 'react-i18next';
import { Capsule } from '@/shared/ui/progress';

export type ProgressTone = 'primary' | 'success' | 'danger' | 'muted';

/**
 * Goal and key-result progress as a glass capsule (ADR 0033) with the percentage inside. The percentage is written
 * out, so the fill is never the only carrier of the information.
 */
export function ProgressBar({
  pct,
  label,
  tone = 'primary',
  large,
}: {
  pct: number;
  label: string;
  tone?: ProgressTone;
  /** A thicker capsule, for the list and the goal page. */
  large?: boolean;
}) {
  const { t } = useTranslation('goals');
  const value = Math.min(100, Math.max(0, pct));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={t('percent', { pct })}
    >
      <Capsule
        percent={value}
        tone={tone}
        size={large ? 'lg' : 'sm'}
        inside={<span aria-hidden="true">{t('percent', { pct })}</span>}
      />
    </div>
  );
}
