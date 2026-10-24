import { zodResolver } from '@hookform/resolvers/zod';
import { LEAVE_COLORS, type LeaveType } from '@intime/contracts';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useChart } from '@/features/organization/hooks';
import { PersonSelect } from '@/features/organization/PersonSelect';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  adjustFormSchema,
  holidayFormSchema,
  settingsFormSchema,
  toAdjustRequest,
  toHolidayRequest,
  toTypeRequest,
  typeFormSchema,
  type AdjustFormValues,
  type HolidayFormValues,
  type SettingsFormValues,
  type TypeFormValues,
} from './forms';
import {
  useAdjustBalance,
  useCreateHoliday,
  useCreateType,
  useDeleteHoliday,
  useHolidays,
  useLeaveSettings,
  useLeaveTypes,
  useUpdateSettings,
  useUpdateType,
} from './hooks';
import { useHolidayName, useTypeName } from './names';
import { useLeaveErrors } from './use-leave-errors';

/** HR/Admin: leave types and policies, holidays, privacy and balance corrections. */
export function SettingsTab({ currentYear }: { currentYear: number }) {
  return (
    <div className="space-y-4">
      <TypesSection />
      <HolidaysSection currentYear={currentYear} />
      <WorkspaceSection />
      <AdjustSection currentYear={currentYear} />
    </div>
  );
}

// ----- types ---------------------------------------------------------------------------------------

function TypesSection() {
  const { t } = useTranslation('leave');
  const types = useLeaveTypes();
  const typeName = useTypeName();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('settings.types.title')}</CardTitle>
        {editing !== 'new' && (
          <Button onClick={() => setEditing('new')}>{t('settings.types.add')}</Button>
        )}
      </div>
      {editing === 'new' && <TypeForm onDone={() => setEditing(null)} />}
      <ul className="space-y-2" aria-label={t('settings.types.title')}>
        {(types.data ?? []).map((type) => (
          <li key={type.id} className="space-y-2 rounded-lg border border-border p-3">
            {editing === type.id ? (
              <TypeForm type={type} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {typeName(type)}{' '}
                    {type.key && (
                      <span className="text-xs text-muted-foreground">
                        ({t('settings.types.system')})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      type.isActive ? t('settings.types.active') : t('settings.types.inactive'),
                      type.requiresApproval ? t('settings.types.requiresApproval') : null,
                      type.allowanceDays !== null
                        ? `${t('settings.types.allowance')}: ${type.allowanceDays}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEditing(type.id)}>
                  {t('settings.types.edit')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TypeForm({ type, onDone }: { type?: LeaveType; onDone: () => void }) {
  const { t } = useTranslation('leave');
  const messages = useMessages();
  const errors = useLeaveErrors();
  const create = useCreateType();
  const update = useUpdateType(type?.id ?? '');
  const mutation = type ? update : create;
  const form = useForm<TypeFormValues>({
    resolver: zodResolver(typeFormSchema),
    defaultValues: {
      // System types have no name; the field is not shown for them, so keep the schema satisfied.
      name: type?.name ?? type?.key ?? '',
      tracksBalance: type?.tracksBalance ?? false,
      requiresApproval: type?.requiresApproval ?? true,
      isSick: type?.isSick ?? false,
      color: type?.color ?? 'primary',
      isActive: type?.isActive ?? true,
      allowanceDays: String(type?.allowanceDays ?? 0),
      carryOverMaxDays: String(type?.carryOverMaxDays ?? 0),
    },
  });
  const tracks = useWatch({ control: form.control, name: 'tracksBalance' });
  const system = Boolean(type?.key);
  const fieldErrors = form.formState.errors;

  const submit = (values: TypeFormValues) => {
    const request = toTypeRequest(values);
    if (type) {
      // System types cannot change what they mean; custom types send everything.
      const { name, tracksBalance, isSick, ...rest } = request;
      void name;
      update.mutate(
        system
          ? { ...rest, isActive: values.isActive }
          : { name, tracksBalance, isSick, ...rest, isActive: values.isActive },
        { onSuccess: onDone },
      );
    } else {
      create.mutate(request, { onSuccess: onDone });
    }
  };

  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit(submit)}>
      {!system && (
        <Field label={t('settings.types.name')} error={messages.validation(fieldErrors.name)}>
          {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
        </Field>
      )}
      <Field label={t('settings.types.color')}>
        {(field) => (
          <Select {...field} {...form.register('color')}>
            {LEAVE_COLORS.map((color) => (
              <option key={color} value={color}>
                {t(`settings.colors.${color}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" {...form.register('requiresApproval')} />
        {t('settings.types.requiresApproval')}
      </label>
      {!system && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" {...form.register('tracksBalance')} />
            {t('settings.types.tracksBalance')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" {...form.register('isSick')} />
            {t('settings.types.isSick')}
          </label>
        </>
      )}
      {(tracks || type?.tracksBalance) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('settings.types.allowance')}
            error={messages.validation(fieldErrors.allowanceDays)}
          >
            {(field) => (
              <Input {...field} inputMode="decimal" {...form.register('allowanceDays')} />
            )}
          </Field>
          <Field
            label={t('settings.types.carryOver')}
            error={messages.validation(fieldErrors.carryOverMaxDays)}
          >
            {(field) => (
              <Input {...field} inputMode="decimal" {...form.register('carryOverMaxDays')} />
            )}
          </Field>
        </div>
      )}
      {type && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" {...form.register('isActive')} />
          {t('settings.types.active')}
        </label>
      )}
      {mutation.isError && <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('settings.types.saving') : t('settings.types.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('settings.types.cancel')}
        </Button>
      </div>
    </form>
  );
}

// ----- holidays ------------------------------------------------------------------------------------

function HolidaysSection({ currentYear }: { currentYear: number }) {
  const { t, i18n } = useTranslation('leave');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const errors = useLeaveErrors();
  const holidayName = useHolidayName();
  const [year, setYear] = useState(currentYear);
  const [country, setCountry] = useState('BG');
  const valid = /^[A-Za-z]{2}$/.test(country);
  const holidays = useHolidays(year, valid ? country.toUpperCase() : '');
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const form = useForm<HolidayFormValues>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: { date: '', name: '', country: '', halfDay: false },
  });
  const fieldErrors = form.formState.errors;

  return (
    <Card className="space-y-3">
      <CardTitle>{t('settings.holidays.title')}</CardTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('settings.holidays.year')}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || currentYear)}
            />
          )}
        </Field>
        <Field label={t('settings.holidays.country')} hint={t('settings.holidays.countryHint')}>
          {(field) => (
            <Input
              {...field}
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          )}
        </Field>
      </div>
      {holidays.data && holidays.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('settings.holidays.none')}</p>
      )}
      <ul className="space-y-1" aria-label={t('settings.holidays.title')}>
        {(holidays.data ?? []).map((holiday) => (
          <li
            key={`${holiday.date}-${holiday.key ?? holiday.id}`}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span>
              <span className="font-medium">{formatDay(holiday.date, language)}</span> ·{' '}
              {holidayName(holiday)}
              {holiday.halfDay && ` (${t('settings.holidays.halfDay')})`}
            </span>
            {holiday.id && (
              <Button
                variant="ghost"
                disabled={remove.isPending}
                aria-label={`${t('settings.holidays.delete')}: ${holidayName(holiday)}`}
                onClick={() => remove.mutate(holiday.id as string)}
              >
                {t('settings.holidays.delete')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={form.handleSubmit((values) =>
          create.mutate(toHolidayRequest(values), { onSuccess: () => form.reset() }),
        )}
      >
        <h3 className="text-sm font-semibold sm:col-span-2">{t('settings.holidays.add')}</h3>
        <Field label={t('settings.holidays.date')} error={messages.validation(fieldErrors.date)}>
          {(field) => <Input {...field} type="date" {...form.register('date')} />}
        </Field>
        <Field label={t('settings.holidays.name')} error={messages.validation(fieldErrors.name)}>
          {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
        </Field>
        <Field
          label={t('settings.holidays.country')}
          hint={t('settings.holidays.allCountries')}
          error={messages.validation(fieldErrors.country)}
        >
          {(field) => <Input {...field} maxLength={2} {...form.register('country')} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" {...form.register('halfDay')} />
          {t('settings.holidays.halfDay')}
        </label>
        {create.isError && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{errors.apiError(create.error)}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t('settings.holidays.add')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ----- workspace settings --------------------------------------------------------------------------

function WorkspaceSection() {
  const settings = useLeaveSettings();
  if (!settings.data) return null;
  return <WorkspaceForm initial={settings.data} />;
}

function WorkspaceForm({
  initial,
}: {
  initial: { hideSickTypeFromTeam: boolean; defaultCountry: string | null };
}) {
  const { t } = useTranslation('leave');
  const messages = useMessages();
  const errors = useLeaveErrors();
  const update = useUpdateSettings();
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      hideSickTypeFromTeam: initial.hideSickTypeFromTeam,
      defaultCountry: initial.defaultCountry ?? '',
    },
  });

  return (
    <Card className="space-y-3">
      <CardTitle>{t('settings.privacy.title')}</CardTitle>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) =>
          update.mutate({
            hideSickTypeFromTeam: values.hideSickTypeFromTeam,
            defaultCountry:
              values.defaultCountry.trim() === ''
                ? null
                : values.defaultCountry.trim().toUpperCase(),
          }),
        )}
      >
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" {...form.register('hideSickTypeFromTeam')} />
          {t('settings.privacy.hideSick')}
        </label>
        <Field
          label={t('settings.privacy.country')}
          hint={t('settings.privacy.countryHint')}
          error={messages.validation(form.formState.errors.defaultCountry)}
        >
          {(field) => <Input {...field} maxLength={2} {...form.register('defaultCountry')} />}
        </Field>
        {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
        {update.isSuccess && <Alert tone="success">{t('settings.privacy.saved')}</Alert>}
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('settings.privacy.saving') : t('settings.privacy.save')}
        </Button>
      </form>
    </Card>
  );
}

// ----- balance corrections -------------------------------------------------------------------------

function AdjustSection({ currentYear }: { currentYear: number }) {
  const { t, i18n } = useTranslation('leave');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const errors = useLeaveErrors();
  const chart = useChart();
  const types = useLeaveTypes();
  const adjust = useAdjustBalance();
  const annual = (types.data ?? []).find((type) => type.tracksBalance && type.key === 'annual');
  const form = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { employeeId: '', year: String(currentYear), delta: '' },
  });
  const fieldErrors = form.formState.errors;
  if (!annual) return null;

  return (
    <Card className="space-y-3">
      <CardTitle>{t('settings.adjust.title')}</CardTitle>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={form.handleSubmit((values) =>
          adjust.mutate(toAdjustRequest(values, annual.id), {
            onSuccess: () => form.setValue('delta', ''),
          }),
        )}
      >
        <div className="sm:col-span-2">
          <Field
            label={t('settings.adjust.employee')}
            error={messages.validation(fieldErrors.employeeId)}
          >
            {(field) => (
              <PersonSelect
                {...field}
                people={chart.data?.nodes ?? []}
                emptyLabel={t('settings.adjust.choose')}
                {...form.register('employeeId')}
              />
            )}
          </Field>
        </div>
        <Field label={t('settings.adjust.year')} error={messages.validation(fieldErrors.year)}>
          {(field) => <Input {...field} inputMode="numeric" {...form.register('year')} />}
        </Field>
        <Field
          label={t('settings.adjust.delta')}
          hint={t('settings.adjust.deltaHint')}
          error={messages.validation(fieldErrors.delta)}
        >
          {(field) => <Input {...field} inputMode="decimal" {...form.register('delta')} />}
        </Field>
        {adjust.isError && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{errors.apiError(adjust.error)}</Alert>
          </div>
        )}
        {adjust.isSuccess && (
          <div className="sm:col-span-2">
            <Alert tone="success">
              {t('settings.adjust.done', { value: formatNumber(adjust.data.remaining, language) })}
            </Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={adjust.isPending}>
            {adjust.isPending ? t('settings.adjust.working') : t('settings.adjust.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
