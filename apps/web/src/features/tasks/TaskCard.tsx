import { TASK_STATUSES, type Task, type TaskStatus } from '@intime/contracts';
import {
  CalendarDays,
  CircleCheck,
  CircleDashed,
  Clock,
  Eye,
  Flag,
  Pencil,
  Timer,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Select } from '@/shared/ui/select';
import { Chip, initials } from '@/shared/ui/tiles';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { useDeleteTask, useUpdateTask } from './hooks';
import { TaskForm } from './TaskForm';
import { useTaskErrors } from './use-task-errors';

/** One icon and colour per stage; the stage is always also written (column, select or text). */
const STAGE: Record<TaskStatus, { icon: LucideIcon; text: string; bar: string }> = {
  todo: { icon: CircleDashed, text: 'text-muted-foreground', bar: 'bg-muted-foreground' },
  in_progress: { icon: Timer, text: 'text-info', bar: 'bg-info' },
  review: { icon: Eye, text: 'text-warning', bar: 'bg-warning' },
  done: { icon: CircleCheck, text: 'text-success', bar: 'bg-success' },
};

/** Four steps, filled up to the current stage: a picture of how far along the task is. */
function StageBar({ status }: { status: TaskStatus }) {
  const step = TASK_STATUSES.indexOf(status);
  return (
    <span aria-hidden="true" className="flex gap-1">
      {TASK_STATUSES.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            i <= step ? STAGE[status].bar : 'bg-secondary',
          )}
        />
      ))}
    </span>
  );
}

function Assignee({ task }: { task: Task }) {
  const { t } = useTranslation('tasks');
  const who = task.assignee;
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
          who ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground',
        )}
      >
        {who ? initials(who.firstName, who.lastName) : '?'}
      </span>
      <span className={cn('truncate', !who && 'text-muted-foreground')}>
        {who ? `${who.firstName} ${who.lastName}` : t('unassigned')}
      </span>
    </span>
  );
}

function Dates({ task }: { task: Task }) {
  const { t, i18n } = useTranslation('tasks');
  const language = i18n.resolvedLanguage ?? 'en';
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {task.dueDate && (
        <span className={cn('flex items-center gap-1.5', task.overdue && 'text-danger')}>
          <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
          {t('card.due', { date: formatDay(task.dueDate, language) })}
        </span>
      )}
      {task.doneOn && (
        <span className="flex items-center gap-1.5">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          {t('card.doneOn', { date: formatDay(task.doneOn, language) })}
        </span>
      )}
      {task.estimateHours !== null && (
        <span className="flex items-center gap-1.5">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          {t('card.hours', { hours: formatNumber(task.estimateHours, language) })}
        </span>
      )}
    </span>
  );
}

/** A task as a row of the list, or (`variant="board"`) as a card in a column. */
export function TaskCard({ task, variant = 'list' }: { task: Task; variant?: 'list' | 'board' }) {
  const { t } = useTranslation('tasks');
  const errors = useTaskErrors();
  const [editing, setEditing] = useState(false);
  const update = useUpdateTask(task.id);
  const remove = useDeleteTask();
  const error = update.error ?? remove.error;
  const board = variant === 'board';
  const stage = STAGE[task.status];
  const StageIcon = stage.icon;

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <TaskForm task={task} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const keyLink = (
    <Link
      to={`/projects/${task.project.id}`}
      className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground hover:underline"
    >
      {task.key}
    </Link>
  );
  const labels = (
    <>
      <Chip>{t(`type.${task.type}`)}</Chip>
      <Chip>{t(`priority.${task.priority}`)}</Chip>
      {task.overdue && (
        <span className="rounded-full border border-danger px-2 py-0.5 text-xs font-medium text-danger">
          {t('card.overdue')}
        </span>
      )}
    </>
  );

  const milestone = task.milestone && (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Flag className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{task.milestone.title}</span>
    </p>
  );

  const status = task.canMove ? (
    <Select
      className={board ? 'w-full' : 'w-auto'}
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
    // On the board the column already says it.
    !board && (
      <span className={cn('flex items-center gap-1.5 text-sm font-medium', stage.text)}>
        <StageIcon className="size-4" aria-hidden="true" />
        <span className="text-foreground">{t(`status.${task.status}`)}</span>
      </span>
    )
  );

  const actions = task.canEdit && (
    <span className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('card.edit')}
        title={t('card.edit')}
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('card.delete')}
        title={t('card.delete')}
        disabled={remove.isPending}
        onClick={() => remove.mutate(task.id)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </span>
  );

  const alert = error && <Alert tone="danger">{errors.apiError(error)}</Alert>;

  if (board) {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-card">
        <div className="flex items-center justify-between gap-2">
          {keyLink}
          {actions}
        </div>
        <p className="break-words text-base font-semibold leading-snug">{task.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">{labels}</div>
        {milestone}
        <StageBar status={task.status} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
          <Assignee task={task} />
          <Dates task={task} />
        </div>
        {status}
        {alert}
      </li>
    );
  }

  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-xl bg-secondary',
            stage.text,
          )}
        >
          <StageIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="break-words text-base font-semibold leading-snug">{task.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {keyLink}
            {labels}
          </div>
          {milestone}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 md:w-52">
          <Assignee task={task} />
          <Dates task={task} />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {status}
          {actions}
        </div>
      </div>
      {alert}
    </li>
  );
}
