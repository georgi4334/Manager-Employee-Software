import { zodResolver } from '@hookform/resolvers/zod';
import type { CalendarEvent, CalendarScope, SeriesMode } from '@intime/contracts';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { useOwnEmployee } from '@/features/employees/hooks';
import { useTeams } from '@/features/organization/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  emptyEvent,
  eventFormSchema,
  toCreateRequest,
  toUpdateRequest,
  valuesOf,
  type EventFormValues,
} from './forms';
import { useCreateEvent, useUpdateEvent } from './hooks';
import { FindTimePanel } from './FindTimePanel';
import { GuestPicker } from './GuestPicker';
import { RepeatFields } from './RepeatFields';
import { SeriesScope } from './SeriesScope';
import { useCalendarErrors } from './use-calendar-errors';

interface EventFormProps {
  /** Editing this event; creating one when omitted. */
  event?: CalendarEvent;
  defaultDate: string;
  onDone: () => void;
}

/** Create or change an event. Which scopes and teams are offered is cosmetic; the server decides. */
export function EventForm({ event, defaultDate, onDone }: EventFormProps) {
  const { t } = useTranslation('calendar');
  const messages = useMessages();
  const errors = useCalendarErrors();
  const create = useCreateEvent();
  const update = useUpdateEvent(event?.id ?? '');
  const mutation = event ? update : create;
  const canTeam = usePermission('calendar.manage_team_calendars');
  const teamsAll = usePermission('calendar.manage_team_calendars', 'all');
  const canCompany = usePermission('calendar.manage_company_calendar');
  const own = useOwnEmployee();
  const teams = useTeams();
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event ? valuesOf(event) : emptyEvent(defaultDate),
  });
  const [mode, setMode] = useState<SeriesMode>('all');
  const [finding, setFinding] = useState(false);
  const scope = useWatch({ control: form.control, name: 'scope' });
  const guestIds = useWatch({ control: form.control, name: 'attendeeIds' });
  const startDate = useWatch({ control: form.control, name: 'startDate' });
  const allDay = useWatch({ control: form.control, name: 'allDay' });
  const fieldErrors = form.formState.errors;

  const scopes: CalendarScope[] = [
    'personal',
    ...(canTeam ? (['team'] as const) : []),
    ...(canCompany ? (['company'] as const) : []),
  ];
  const myTeams = (teams.data ?? []).filter(
    (team) =>
      teamsAll ||
      (own.data &&
        (team.lead?.id === own.data.id || team.members.some((m) => m.id === own.data.id))),
  );

  const submit = (v: EventFormValues) => {
    const done = { onSuccess: onDone };
    if (event) {
      const scoped = mode === 'all' ? undefined : { mode, occurrence: event.occurrenceDate };
      update.mutate({ body: toUpdateRequest(v, event, mode), scope: scoped }, done);
    } else create.mutate(toCreateRequest(v), done);
  };

  const canInvite = scope === 'personal' && (!event || event.isOrganizer);

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(submit)}
      aria-label={event ? t('form.editTitle') : t('form.newTitle')}
    >
      {!event && (
        <>
          <Field label={t('form.scope')}>
            {(field) => (
              <Select {...field} {...form.register('scope')}>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {t(`form.scopes.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {scope === 'team' && (
            <Field label={t('form.team')} error={messages.validation(fieldErrors.teamId)}>
              {(field) => (
                <Select {...field} {...form.register('teamId')}>
                  <option value="">—</option>
                  {myTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </>
      )}
      <div className="sm:col-span-2">
        <Field label={t('form.title')} error={messages.validation(fieldErrors.title)}>
          {(field) => (
            <Input {...field} maxLength={120} autoComplete="off" {...form.register('title')} />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-5" {...form.register('allDay')} />
        {t('form.allDay')}
      </label>
      <Field label={t('form.startDate')} error={messages.validation(fieldErrors.startDate)}>
        {(field) => <Input {...field} type="date" {...form.register('startDate')} />}
      </Field>
      <Field label={t('form.endDate')} error={messages.validation(fieldErrors.endDate)}>
        {(field) => <Input {...field} type="date" {...form.register('endDate')} />}
      </Field>
      {!allDay && (
        <>
          <Field label={t('form.startTime')} error={messages.validation(fieldErrors.startTime)}>
            {(field) => <Input {...field} type="time" {...form.register('startTime')} />}
          </Field>
          <Field label={t('form.endTime')} error={messages.validation(fieldErrors.endTime)}>
            {(field) => <Input {...field} type="time" {...form.register('endTime')} />}
          </Field>
        </>
      )}
      {canInvite && (
        <>
          <GuestPicker
            value={guestIds}
            onChange={(ids) => form.setValue('attendeeIds', ids, { shouldDirty: true })}
          />
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              aria-expanded={finding}
              onClick={() => setFinding((open) => !open)}
            >
              {t('findTime.open')}
            </Button>
          </div>
          {finding && (
            <FindTimePanel
              from={startDate}
              guestIds={guestIds}
              onPick={(slot) => {
                form.setValue('allDay', false, { shouldDirty: true });
                form.setValue('startDate', slot.date, { shouldDirty: true });
                form.setValue('endDate', slot.date, { shouldDirty: true });
                form.setValue('startTime', slot.startTime, { shouldDirty: true });
                form.setValue('endTime', slot.endTime, { shouldDirty: true });
              }}
            />
          )}
        </>
      )}
      {event?.recurrence && (
        <div className="sm:col-span-2">
          <SeriesScope value={mode} onChange={setMode} />
        </div>
      )}
      {mode !== 'this' && <RepeatFields form={form} />}
      <div className="sm:col-span-2">
        <Field label={t('form.location')} error={messages.validation(fieldErrors.location)}>
          {(field) => (
            <Input {...field} maxLength={200} autoComplete="off" {...form.register('location')} />
          )}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t('form.description')} error={messages.validation(fieldErrors.description)}>
          {(field) => (
            <Input
              {...field}
              maxLength={1000}
              autoComplete="off"
              {...form.register('description')}
            />
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
          {mutation.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
