import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { formatDay } from '@/shared/lib/format';
import { useLeaveConflicts } from './hooks';
import { useLeaveErrors } from './use-leave-errors';

/** On demand: the projects, milestones and tasks a request collides with. Informational, never blocking. */
export function ConflictsPanel({ requestId, name }: { requestId: string; name: string }) {
  const { t, i18n } = useTranslation('leave');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useLeaveErrors();
  const [open, setOpen] = useState(false);
  const query = useLeaveConflicts(requestId, open);
  const data = query.data;
  const none = data && data.assignments.length + data.milestones.length + data.tasks.length === 0;

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-label={t(open ? 'conflicts.hideFor' : 'conflicts.showFor', { name })}
        onClick={() => setOpen(!open)}
      >
        {t(open ? 'conflicts.hide' : 'conflicts.show')}
      </Button>
      {open && query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {open && query.isError && <Alert tone="danger">{errors.apiError(query.error)}</Alert>}
      {open && none && <p className="text-sm text-muted-foreground">{t('conflicts.none')}</p>}
      {open && data && !none && (
        <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
          {data.assignments.length > 0 && (
            <section aria-label={t('conflicts.projects')}>
              <h4 className="font-medium">{t('conflicts.projects')}</h4>
              <ul className="list-disc pl-5">
                {data.assignments.map((a) => (
                  <li key={`${a.projectId}-${a.fromDate}`}>
                    {a.code} · {a.name} ({t('conflicts.allocation', { percent: a.allocationPct })})
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.milestones.length > 0 && (
            <section aria-label={t('conflicts.milestones')}>
              <h4 className="font-medium">{t('conflicts.milestones')}</h4>
              <ul className="list-disc pl-5">
                {data.milestones.map((m) => (
                  <li key={m.id}>
                    {m.code} · {m.title} — {formatDay(m.dueDate, language)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.tasks.length > 0 && (
            <section aria-label={t('conflicts.tasks')}>
              <h4 className="font-medium">{t('conflicts.tasks')}</h4>
              <ul className="list-disc pl-5">
                {data.tasks.map((task) => (
                  <li key={task.id}>
                    {task.key} — {formatDay(task.dueDate, language)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
