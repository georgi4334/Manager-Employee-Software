import { TASK_STATUSES, type Task, type TaskStatus } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Select } from '@/shared/ui/select';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { useDeleteTask, useUpdateTask } from './hooks';
import { TaskForm } from './TaskForm';
import { useTaskErrors } from './use-task-errors';

export function TaskCard({ task }: { task: Task }) {
  const { t, i18n } = useTranslation('tasks');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useTaskErrors();
  const [editing, setEditing] = useState(false);
  const update = useUpdateTask(task.id);
  const remove = useDeleteTask();
  const error = update.error ?? remove.error;

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <TaskForm task={task} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{task.title}</p>
          <p className="text-sm text-muted-foreground">
            <Link to={`/projects/${task.project.id}`} className="text-primary underline">
              {task.key}
            </Link>
            {' · '}
            {t(`type.${task.type}`)}
            {' · '}
            {t(`priority.${task.priority}`)}
          </p>
        </div>
        {task.overdue && (
          <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">
            {t('card.overdue')}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : t('unassigned')}
        {task.milestone && ` · ${task.milestone.title}`}
        {task.dueDate && ` · ${t('card.due', { date: formatDay(task.dueDate, language) })}`}
        {task.doneOn && ` · ${t('card.doneOn', { date: formatDay(task.doneOn, language) })}`}
        {task.estimateHours !== null &&
          ` · ${t('card.hours', { hours: formatNumber(task.estimateHours, language) })}`}
      </p>
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {task.canMove ? (
          <Select
            className="w-auto"
            aria-label={t('card.status', { key: task.key })}
            value={task.status}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ status: e.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-sm">{t(`status.${task.status}`)}</span>
        )}
        {task.canEdit && (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('card.edit')}
            </Button>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(task.id)}
            >
              {t('card.delete')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
