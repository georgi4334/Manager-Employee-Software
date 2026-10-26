import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import type { OneOnOneDetail } from '@intime/contracts';
import { ActionItems } from './ActionItems';
import {
  notesFormSchema,
  toUpdateNotes,
  toUpdateWhen,
  valuesOfNotes,
  valuesOfWhen,
  whenFormSchema,
  type NotesFormValues,
  type WhenFormValues,
} from './forms';
import { useMeeting, useUpdateMeeting } from './hooks';
import { useMeetingErrors } from './use-meeting-errors';

function NotesForm({
  meeting,
  saved,
  onSaved,
}: {
  meeting: OneOnOneDetail;
  /** Kept by the page: saving refreshes the meeting, which remounts this form. */
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const { t } = useTranslation('meetings');
  const messages = useMessages();
  const errors = useMeetingErrors();
  const update = useUpdateMeeting(meeting.id);
  const initial = useMemo(() => valuesOfNotes(meeting), [meeting]);
  const form = useForm<NotesFormValues>({
    resolver: zodResolver(notesFormSchema),
    defaultValues: initial,
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      aria-label={t('notes.title')}
      onSubmit={form.handleSubmit((v) => {
        const body = toUpdateNotes(v, initial);
        if (Object.keys(body).length === 0) return;
        onSaved(false);
        update.mutate(body, { onSuccess: () => onSaved(true) });
      })}
    >
      <Field label={t('notes.agenda')} error={messages.validation(e.agenda)}>
        {(field) => <Textarea {...field} maxLength={1000} {...form.register('agenda')} />}
      </Field>
      <Field
        label={t('notes.shared')}
        hint={t('notes.sharedHint')}
        error={messages.validation(e.sharedNotes)}
      >
        {(field) => <Textarea {...field} maxLength={2000} {...form.register('sharedNotes')} />}
      </Field>
      <Field
        label={t('notes.private')}
        hint={t('notes.privateHint')}
        error={messages.validation(e.privateNotes)}
      >
        {(field) => <Textarea {...field} maxLength={2000} {...form.register('privateNotes')} />}
      </Field>
      {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('notes.saved')}
        </p>
      )}
      <Button type="submit" disabled={update.isPending}>
        {t('notes.save')}
      </Button>
    </form>
  );
}

function WhenForm({ meeting, onDone }: { meeting: OneOnOneDetail; onDone: () => void }) {
  const { t } = useTranslation('meetings');
  const messages = useMessages();
  const errors = useMeetingErrors();
  const update = useUpdateMeeting(meeting.id);
  const initial = useMemo(() => valuesOfWhen(meeting), [meeting]);
  const form = useForm<WhenFormValues>({
    resolver: zodResolver(whenFormSchema),
    defaultValues: initial,
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-3"
      aria-label={t('when.title')}
      onSubmit={form.handleSubmit((v) => {
        const body = toUpdateWhen(v, initial);
        if (Object.keys(body).length === 0) return onDone();
        update.mutate(body, { onSuccess: onDone });
      })}
    >
      <Field label={t('form.date')} error={messages.validation(e.date)}>
        {(field) => <Input {...field} type="date" {...form.register('date')} />}
      </Field>
      <Field label={t('form.time')} error={messages.validation(e.time)}>
        {(field) => <Input {...field} type="time" {...form.register('time')} />}
      </Field>
      <Field label={t('form.minutes')} error={messages.validation(e.durationMinutes)}>
        {(field) => <Input {...field} inputMode="numeric" {...form.register('durationMinutes')} />}
      </Field>
      {update.isError && (
        <div className="sm:col-span-3">
          <Alert tone="danger">{errors.apiError(update.error)}</Alert>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={update.isPending}>
          {t('when.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation('meetings');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useMeetingErrors();
  const query = useMeeting(id);
  const update = useUpdateMeeting(id);
  const [moving, setMoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const meeting = query.data;

  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (query.isError || !meeting) {
    return (
      <Card className="mx-auto max-w-3xl space-y-3 text-center">
        <Alert tone="danger">
          {isApiError(query.error, 'NOT_FOUND') ? t('notFound') : errors.apiError(query.error)}
        </Alert>
        <Link to="/one-on-ones" className="text-primary underline">
          {t('back')}
        </Link>
      </Card>
    );
  }
  const person = `${meeting.other.firstName} ${meeting.other.lastName}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/one-on-ones" className="text-sm text-primary underline">
        {t('back')}
      </Link>
      <Card className="space-y-3">
        <h1 className="break-words text-2xl font-semibold">{t('card.with', { name: person })}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDay(meeting.date, language)} · {meeting.time} ·{' '}
          {t('card.minutes', { count: meeting.durationMinutes })} · {t(`status.${meeting.status}`)}
        </p>
        {meeting.status === 'cancelled' && <Alert tone="info">{t('rule.cancelled')}</Alert>}
        {moving && meeting.canEdit ? (
          <WhenForm meeting={meeting} onDone={() => setMoving(false)} />
        ) : (
          meeting.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMoving(true)}>
                {t('when.change')}
              </Button>
              {meeting.status === 'scheduled' && (
                <Button
                  variant="secondary"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ status: 'done' })}
                >
                  {t('markDone')}
                </Button>
              )}
              {confirming ? (
                <>
                  <Button
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate(
                        { status: 'cancelled' },
                        { onSuccess: () => setConfirming(false) },
                      )
                    }
                  >
                    {t('confirmCancel')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t('form.cancel')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirming(true)}>
                  {t('cancelMeeting')}
                </Button>
              )}
            </div>
          )
        )}
        {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
      </Card>

      {meeting.canEdit ? (
        <Card>
          <NotesForm
            key={`${meeting.agenda}|${meeting.sharedNotes}|${meeting.privateNotes}`}
            meeting={meeting}
            saved={saved}
            onSaved={setSaved}
          />
        </Card>
      ) : (
        <Card className="space-y-2">
          <h2 className="text-base font-semibold">{t('notes.title')}</h2>
          <p className="whitespace-pre-line break-words text-sm">{meeting.agenda ?? '—'}</p>
          <p className="whitespace-pre-line break-words text-sm">{meeting.sharedNotes ?? '—'}</p>
        </Card>
      )}
      <Card>
        <ActionItems meeting={meeting} />
      </Card>
    </div>
  );
}
