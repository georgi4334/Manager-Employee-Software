import { formatDuration, type TimeEntry } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { EntryForm } from './EntryForm';
import { useDeleteEntry } from './hooks';
import { useTimeErrors } from './use-time-errors';

export function EntryRow({ entry }: { entry: TimeEntry }) {
  const { t } = useTranslation('time');
  const errors = useTimeErrors();
  const [editing, setEditing] = useState(false);
  const remove = useDeleteEntry();

  if (editing) {
    return (
      <li className="rounded-lg border border-border p-3">
        <EntryForm entry={entry} defaultDate={entry.workDate} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">
            {entry.project.code} · {entry.project.name}
            {entry.task && <span className="text-muted-foreground"> · {entry.task.key}</span>}
          </p>
          {entry.note && <p className="break-words text-sm text-muted-foreground">{entry.note}</p>}
          <p className="text-xs text-muted-foreground">
            {entry.isBillable ? t('entry.billable') : t('entry.notBillable')}
          </p>
        </div>
        <p className="text-lg font-semibold tabular-nums">
          {entry.minutes === null
            ? t('entry.running')
            : t('hours', { value: formatDuration(entry.minutes) })}
        </p>
      </div>
      {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
      {entry.canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('entry.edit')}
          </Button>
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate(entry.id)}
          >
            {t('entry.delete')}
          </Button>
        </div>
      )}
    </li>
  );
}
