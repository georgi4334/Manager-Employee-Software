import type { TimesheetStatus } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

const TONE: Record<TimesheetStatus | 'none', string> = {
  none: 'border-border text-muted-foreground',
  open: 'border-border text-muted-foreground',
  submitted: 'border-warning text-warning',
  approved: 'border-success text-success',
  rejected: 'border-danger text-danger',
};

/** The state of a week in words (never by colour alone). */
export function StatusBadge({ status }: { status: TimesheetStatus | null }) {
  const { t } = useTranslation('time');
  const key = status ?? 'none';
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-xs', TONE[key])}>
      {t(`status.${key}`)}
    </span>
  );
}
