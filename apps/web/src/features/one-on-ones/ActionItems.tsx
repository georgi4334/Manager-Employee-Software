import { zodResolver } from '@hookform/resolvers/zod';
import { MAX_ACTION_ITEMS, type OneOnOneDetail } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  actionItemFormSchema,
  emptyActionItem,
  toCreateActionItem,
  type ActionItemFormValues,
} from './forms';
import { useAddActionItem, useRemoveActionItem, useUpdateActionItem } from './hooks';
import { useMeetingErrors } from './use-meeting-errors';

export function ActionItems({ meeting }: { meeting: OneOnOneDetail }) {
  const { t, i18n } = useTranslation('meetings');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const errors = useMeetingErrors();
  const add = useAddActionItem(meeting.id);
  const update = useUpdateActionItem(meeting.id);
  const remove = useRemoveActionItem(meeting.id);
  const form = useForm<ActionItemFormValues>({
    resolver: zodResolver(actionItemFormSchema),
    defaultValues: emptyActionItem(),
  });
  const e = form.formState.errors;
  const error = add.error ?? update.error ?? remove.error;
  const full = meeting.actionItems.length >= MAX_ACTION_ITEMS;
  const other = meeting.role === 'manager' ? meeting.employee : meeting.manager;

  return (
    <section aria-labelledby="items-heading" className="space-y-3">
      <h2 id="items-heading" className="text-base font-semibold">
        {t('items.heading')}
      </h2>
      {meeting.actionItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('items.none')}</p>
      ) : (
        <ul className="space-y-2" aria-labelledby="items-heading">
          {meeting.actionItems.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <input
                type="checkbox"
                className="size-5"
                aria-label={t('items.done', { title: i.title })}
                checked={i.done}
                disabled={!meeting.canEdit || update.isPending}
                onChange={(ev) =>
                  update.mutate({ itemId: i.id, body: { done: ev.target.checked } })
                }
              />
              <div className="min-w-0 flex-1">
                <p className={i.done ? 'break-words line-through' : 'break-words'}>{i.title}</p>
                <p className="text-sm text-muted-foreground">
                  {i.owner.firstName} {i.owner.lastName}
                  {i.dueDate && ` · ${t('items.due', { date: formatDay(i.dueDate, language) })}`}
                  {i.overdue && ` · ${t('items.overdue')}`}
                </p>
              </div>
              {meeting.canEdit && (
                <Button
                  variant="ghost"
                  disabled={remove.isPending}
                  aria-label={t('items.remove', { title: i.title })}
                  onClick={() => remove.mutate(i.id)}
                >
                  {t('items.removeShort')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {meeting.canEdit && !full && (
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          aria-label={t('items.newTitle')}
          onSubmit={form.handleSubmit((v) =>
            add.mutate(toCreateActionItem(v), { onSuccess: () => form.reset(emptyActionItem()) }),
          )}
        >
          <div className="sm:col-span-2">
            <Field label={t('items.title')} error={messages.validation(e.title)}>
              {(field) => (
                <Input {...field} maxLength={120} autoComplete="off" {...form.register('title')} />
              )}
            </Field>
          </div>
          <Field label={t('items.owner')}>
            {(field) => (
              <Select {...field} {...form.register('ownerEmployeeId')}>
                <option value="">{t('items.me')}</option>
                <option value={other.id}>
                  {other.firstName} {other.lastName}
                </option>
              </Select>
            )}
          </Field>
          <Field label={t('items.dueDate')} error={messages.validation(e.dueDate)}>
            {(field) => <Input {...field} type="date" {...form.register('dueDate')} />}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={add.isPending}>
              {t('items.add')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
