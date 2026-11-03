import { zodResolver } from '@hookform/resolvers/zod';
import {
  CHECKLIST_RESPONSIBLES,
  checklistProgress,
  type ChecklistDetail,
  type ChecklistItem,
} from '@intime/contracts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { useChart } from '@/features/organization/hooks';
import { formatDate, formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { BackLink } from '@/shared/ui/back-link';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Capsule } from '@/shared/ui/progress';
import { Select } from '@/shared/ui/select';
import { SkeletonCard, SkeletonGroup } from '@/shared/ui/skeleton';
import { Textarea } from '@/shared/ui/textarea';
import { itemFormSchema, toCreateItem, toUpdateItem, type ItemFormValues } from './forms';
import {
  useAddItem,
  useCancelChecklist,
  useChecklist,
  useDeleteItem,
  useTickItem,
  useUpdateItem,
} from './hooks';
import { KindPill, StateChip, StatusPill, TickButton, itemState, useToday } from './ui';
import { useChecklistErrors } from './use-checklist-errors';

/** One checklist: the steps by due date, ticked by whoever does them (docs/adr/0040-onboarding-checklists.md). */
export function ChecklistDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation('checklists');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useChecklistErrors();
  const query = useChecklist(id);

  if (query.isPending)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink to="/checklists">{t('detail.back')}</BackLink>
        <SkeletonGroup label={t('loading')}>
          <SkeletonCard rows={5} />
        </SkeletonGroup>
      </div>
    );
  if (query.isError)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink to="/checklists">{t('detail.back')}</BackLink>
        {isApiError(query.error, 'NOT_FOUND') ? (
          <>
            <h1 className="text-2xl font-semibold">{t('detail.notFoundTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('detail.notFoundText')}</p>
          </>
        ) : (
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
        )}
      </div>
    );
  const c = query.data;
  const progress = checklistProgress(c.items);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink to="/checklists">{t('detail.back')}</BackLink>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <KindPill kind={c.kind} />
          <StatusPill status={c.status} />
        </div>
        <h1 className="break-words text-2xl font-semibold">
          {c.employee.firstName} {c.employee.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {c.name} · {t(`anchor.${c.kind}`, { date: formatDay(c.anchorDate, language) })}
        </p>
        <Capsule
          size="lg"
          percent={progress.percent}
          tone={c.status === 'done' ? 'success' : 'primary'}
          inside={`${progress.percent} %`}
          after={t('progress', { done: progress.done, total: progress.total })}
        />
        {c.status === 'cancelled' && c.cancelledAt && (
          <Alert tone="info">
            {t('detail.cancelled', { date: formatDate(c.cancelledAt, language) })}
          </Alert>
        )}
        {c.status === 'done' && <Alert tone="success">{t('detail.completed')}</Alert>}
      </header>
      <Steps checklist={c} />
      {c.canManage && <ManageActions checklist={c} />}
    </div>
  );
}

function Steps({ checklist }: { checklist: ChecklistDetail }) {
  const { t, i18n } = useTranslation('checklists');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useChecklistErrors();
  const today = useToday();
  const tick = useTickItem();
  const remove = useDeleteItem(checklist.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const items = [...checklist.items].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
  );

  return (
    <section aria-labelledby="checklist-steps" className="space-y-2">
      <h2 id="checklist-steps" className="text-base font-semibold">
        {t('detail.items')}
      </h2>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {(tick.isError || remove.isError) && (
        <Alert tone="danger">{errors.apiError(tick.error ?? remove.error)}</Alert>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('detail.empty')}</p>
      ) : (
        <ul aria-labelledby="checklist-steps" className="divide-y divide-border rounded-xl glass">
          {items.map((item) =>
            editing === item.id ? (
              <li key={item.id} className="p-3 sm:p-4">
                <ItemForm checklistId={checklist.id} item={item} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <StepRow
                key={item.id}
                item={item}
                language={language}
                state={itemState(item, today)}
                manage={checklist.canManage}
                busy={tick.isPending || remove.isPending}
                onTick={() =>
                  tick.mutate(
                    { checklistId: checklist.id, itemId: item.id, done: !item.done },
                    {
                      onSuccess: () =>
                        setSaid(t(item.done ? 'unticked' : 'ticked', { title: item.title })),
                    },
                  )
                }
                onEdit={() => setEditing(item.id)}
                onRemove={() => remove.mutate(item.id)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function StepRow({
  item,
  language,
  state,
  manage,
  busy,
  onTick,
  onEdit,
  onRemove,
}: {
  item: ChecklistItem;
  language: string;
  state: ReturnType<typeof itemState>;
  manage: boolean;
  busy: boolean;
  onTick: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('checklists');
  const who = item.assignee ? `${item.assignee.firstName} ${item.assignee.lastName}` : t('hrGroup');
  return (
    <li className="flex items-start gap-2 p-3 sm:px-4">
      <TickButton
        title={item.title}
        done={item.done}
        disabled={busy || !item.canTick}
        onToggle={onTick}
      />
      <div className="min-w-0 flex-1 space-y-0.5 py-1.5">
        <p
          className={
            item.done
              ? 'break-words font-semibold leading-snug text-muted-foreground line-through'
              : 'break-words font-semibold leading-snug'
          }
        >
          {item.title}
        </p>
        {item.description && (
          <p className="break-words text-sm text-muted-foreground">{item.description}</p>
        )}
        <p className="break-words text-sm text-muted-foreground">
          {t(`responsible.${item.responsible}`)} · {who} ·{' '}
          {t('due', { date: formatDay(item.dueDate, language) })}
        </p>
        {item.done && item.doneAt && (
          <p className="text-xs text-muted-foreground">
            {item.doneBy
              ? t('detail.doneBy', {
                  name: `${item.doneBy.firstName} ${item.doneBy.lastName}`,
                  date: formatDate(item.doneAt, language),
                })
              : t('detail.doneOn', { date: formatDate(item.doneAt, language) })}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 py-1.5">
        <StateChip state={state} />
        {manage && (
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('detail.edit', { title: item.title })}
              onClick={onEdit}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('detail.remove', { title: item.title })}
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function ItemForm({
  checklistId,
  item,
  onDone,
}: {
  checklistId: string;
  item?: ChecklistItem;
  onDone: () => void;
}) {
  const { t } = useTranslation('checklists');
  const { t: tv } = useTranslation('errors');
  const errors = useChecklistErrors();
  const chart = useChart();
  const add = useAddItem(checklistId);
  const update = useUpdateItem(checklistId);
  const today = useToday();
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: item
      ? {
          title: item.title,
          description: item.description ?? '',
          responsible: item.responsible,
          dueDate: item.dueDate,
          assigneeEmployeeId: item.assignee?.id ?? '',
        }
      : { title: '', description: '', responsible: 'hr', dueDate: today, assigneeEmployeeId: '' },
  });
  const err = (key?: string) =>
    key ? tv(`validation.${key}` as 'validation.required') : undefined;
  const people = [...(chart.data?.nodes ?? [])].sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
  );
  const mutation = item ? update : add;
  const fe = form.formState.errors;

  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label={item ? t('detail.edit', { title: item.title }) : t('detail.add')}
      onSubmit={form.handleSubmit((values) =>
        item
          ? update.mutate({ itemId: item.id, body: toUpdateItem(values) }, { onSuccess: onDone })
          : add.mutate(toCreateItem(values), { onSuccess: onDone }),
      )}
    >
      <div className="sm:col-span-2">
        <Field label={t('detail.title')} error={err(fe.title?.message)}>
          {(p) => <Input {...p} {...form.register('title')} />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t('detail.description')} error={err(fe.description?.message)}>
          {(p) => <Textarea {...p} rows={2} {...form.register('description')} />}
        </Field>
      </div>
      <Field label={t('detail.responsible')}>
        {(p) => (
          <Select {...p} {...form.register('responsible')}>
            {CHECKLIST_RESPONSIBLES.map((r) => (
              <option key={r} value={r}>
                {t(`responsible.${r}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('detail.dueDate')} error={err(fe.dueDate?.message)}>
        {(p) => <Input {...p} type="date" {...form.register('dueDate')} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('detail.assignee')}>
          {(p) => (
            <Select {...p} {...form.register('assigneeEmployeeId')}>
              <option value="">{item ? t('hrGroup') : t('detail.assigneeAuto')}</option>
              {people.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.firstName} {n.lastName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {mutation.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function ManageActions({ checklist }: { checklist: ChecklistDetail }) {
  const { t } = useTranslation('checklists');
  const errors = useChecklistErrors();
  const cancel = useCancelChecklist(checklist.id);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-3">
      {adding ? (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('detail.add')}</h2>
          <ItemForm checklistId={checklist.id} onDone={() => setAdding(false)} />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t('detail.add')}
        </Button>
      )}
      {checklist.status === 'open' &&
        (confirming ? (
          <Card className="space-y-3">
            <p className="font-medium">{t('detail.confirmCancel')}</p>
            {cancel.isError && <Alert tone="danger">{errors.apiError(cancel.error)}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false) })}
              >
                {t('detail.yesCancel')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t('detail.keep')}
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
            {t('detail.cancelChecklist')}
          </Button>
        ))}
    </div>
  );
}
