import { formatDuration } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatDay } from '@/shared/lib/format';
import { useCompare } from './hooks';

interface ComparePanelProps {
  weekStart: string;
  /** Another person's week (approvals); omitted = your own. */
  employeeId?: string;
  /** Show right away instead of behind a button. */
  openByDefault?: boolean;
}

/**
 * Presence next to logged time. A mirror, not a verdict: it only points at days where the two differ by more than
 * half an hour. When the server does not offer the comparison (no permission) nothing is shown at all.
 */
export function ComparePanel({ weekStart, employeeId, openByDefault = false }: ComparePanelProps) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  const [open, setOpen] = useState(openByDefault);
  const query = useCompare(weekStart, employeeId, open);
  if (query.isError) return null;
  const days = (query.data?.days ?? []).filter(
    (d) => d.attendanceMinutes > 0 || d.loggedMinutes > 0 || d.onLeave || d.openRecord,
  );

  return (
    <div className="space-y-2">
      {!openByDefault && (
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t(open ? 'compare.hide' : 'compare.show')}
        </Button>
      )}
      {open && query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {open && query.data && (
        <section
          aria-label={t('compare.title')}
          className="space-y-2 rounded-lg border border-border p-3"
        >
          <h3 className="text-sm font-semibold">{t('compare.title')}</h3>
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('compare.empty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {days.map((d) => (
                <li key={d.date}>
                  <span className="font-medium">
                    {formatDay(d.date, language, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  {': '}
                  {t('compare.row', {
                    present: formatDuration(d.attendanceMinutes),
                    logged: formatDuration(d.loggedMinutes),
                  })}
                  {d.onLeave && ` · ${t('compare.onLeave')}`}
                  {d.openRecord && ` · ${t('compare.open')}`}
                  {d.flag !== 'none' && (
                    <strong className="ml-1">{` · ${t(`compare.flag.${d.flag}`)}`}</strong>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('compare.hint')}</p>
        </section>
      )}
    </div>
  );
}
