import { TASK_STATUSES, type Task, type TaskStatus } from '@intime/contracts';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { useMoveTask } from './hooks';
import { TaskCard } from './TaskCard';
import { useTaskErrors } from './use-task-errors';

const COLUMN_DOT: Record<TaskStatus, string> = {
  todo: 'bg-muted-foreground',
  in_progress: 'bg-info',
  review: 'bg-warning',
  done: 'bg-success',
};

/**
 * The board: one column per status. With a mouse a card the user may move (`canMove`) can be dragged to another column;
 * that sends the same request as the card's status select, which stays for keyboard, touch and screen readers
 * (docs/adr/0014-tasks.md). While saving, the card already sits in its new column; on an error it goes back.
 */
export function Board({ items }: { items: readonly Task[] }) {
  const { t } = useTranslation('tasks');
  const errors = useTaskErrors();
  const move = useMoveTask();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [moving, setMoving] = useState<{ id: string; status: TaskStatus } | null>(null);
  const [said, setSaid] = useState('');

  const statusOf = (task: Task) => (moving?.id === task.id ? moving.status : task.status);
  const accepts = (column: TaskStatus) => dragging !== null && statusOf(dragging) !== column;

  const drop = (column: TaskStatus) => {
    const task = dragging;
    setDragging(null);
    setOver(null);
    if (!task || statusOf(task) === column) return;
    setMoving({ id: task.id, status: column });
    move.mutate(
      { id: task.id, status: column },
      {
        onSuccess: () =>
          setSaid(t('board.moved', { key: task.key, status: t(`status.${column}`) })),
        onSettled: () => setMoving(null),
      },
    );
  };

  const columnEvents = (column: TaskStatus) => ({
    onDragOver: (e: DragEvent) => {
      if (!accepts(column)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== column) setOver(column);
    },
    onDragLeave: (e: DragEvent) => {
      // Leaving for a child of the same column is not leaving the column.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if (over === column) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      drop(column);
    },
  });

  return (
    <div className="space-y-3">
      <p className="hidden text-sm text-muted-foreground md:block">{t('board.hint')}</p>
      {move.isError && <Alert tone="danger">{errors.apiError(move.error)}</Alert>}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((s) => {
          const column = items.filter((task) => statusOf(task) === s);
          const target = over === s;
          return (
            <section
              key={s}
              aria-labelledby={`board-${s}`}
              data-drop-target={target ? 'true' : undefined}
              {...columnEvents(s)}
              className={cn(
                'space-y-3 rounded-2xl glass p-3 transition-[outline-color] duration-200',
                'outline-2 outline-offset-2 outline-dashed',
                target ? 'outline-primary' : 'outline-transparent',
              )}
            >
              <h2 id={`board-${s}`} className="flex items-center gap-2 px-1 text-sm font-semibold">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${COLUMN_DOT[s]}`} />
                {t(`status.${s}`)} ({column.length})
              </h2>
              <ul className="space-y-3" aria-labelledby={`board-${s}`}>
                {column.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={{ ...task, status: statusOf(task) }}
                    variant="board"
                    drag={{
                      dragging: dragging?.id === task.id,
                      onStart: setDragging,
                      onEnd: () => {
                        setDragging(null);
                        setOver(null);
                      },
                    }}
                  />
                ))}
              </ul>
              {column.length === 0 && (
                <p
                  className={cn(
                    'rounded-xl border border-dashed p-4 text-center text-sm',
                    target
                      ? 'border-primary text-foreground'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {target ? t('board.dropHere') : t('board.empty')}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
