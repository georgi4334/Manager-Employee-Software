import { zodResolver } from '@hookform/resolvers/zod';
import {
  COMPENSATION_BASES,
  COMPENSATION_CURRENCIES,
  todayIn,
  type Compensation,
  type Employee,
} from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { formatDay, formatMoney } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { useCompensation, useRemoveCompensation, useSetCompensation } from './compensation';
import {
  compensationFormSchema,
  emptyCompensation,
  toCompensationRequest,
  type CompensationFormValues,
} from './compensation-form';
import { useEmployeeErrors } from './use-employee-messages';

/**
 * Salary and hourly rates (ADR 0030). Rendered only for people who hold `compensation.view`; the server decides what
 * they get. Nobody changes their own pay, so the buttons are hidden on one's own profile (the server refuses it too).
 */
export function CompensationCard({ employee }: { employee: Employee }) {
  const allowed = usePermission('compensation.view');
  if (!allowed || employee.erased) return null;
  return <CompensationPanel employee={employee} />;
}

function CompensationPanel({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation('employees');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useEmployeeErrors();
  const query = useCompensation(employee.id, true);
  const remove = useRemoveCompensation(employee.id);
  const [editing, setEditing] = useState(false);
  const state = query.data;
  const canChange = Boolean(state?.canManage) && !employee.isSelf;

  return (
    <Card className="space-y-3" aria-labelledby="compensation-title">
      <CardTitle id="compensation-title">{t('compensation.title')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('compensation.note')}</p>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('compensation.loading')}
        </p>
      )}
      {query.isError && <Alert tone="danger">{errors.apiError(query.error)}</Alert>}
      {state && (
        <>
          {state.items.length === 0 ? (
            <p className="text-sm">{t('compensation.none')}</p>
          ) : (
            <ul aria-label={t('compensation.list')} className="space-y-2">
              {state.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {t('compensation.amount', {
                        amount: formatMoney(item.amountMinor, item.currency, language),
                        basis: t(`compensation.basis.${item.basis}`),
                      })}
                    </span>
                    {' · '}
                    {t('compensation.from', { date: formatDay(item.validFrom, language) })}
                    {item.current && (
                      <span className="ml-2 rounded-full border border-primary px-2 py-0.5 text-xs text-primary">
                        {t('compensation.inForce')}
                      </span>
                    )}
                  </span>
                  {canChange && (
                    <Button
                      variant="ghost"
                      disabled={remove.isPending}
                      aria-label={t('compensation.remove', {
                        date: formatDay(item.validFrom, language),
                      })}
                      onClick={() => remove.mutate(item.id)}
                    >
                      {t('compensation.removeShort')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
          {employee.isSelf && state.canManage && (
            <p className="text-sm text-muted-foreground">{t('compensation.own')}</p>
          )}
          {canChange && !editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('compensation.change')}
            </Button>
          )}
          {canChange && editing && (
            <CompensationForm employee={employee} state={state} onDone={() => setEditing(false)} />
          )}
        </>
      )}
    </Card>
  );
}

function CompensationForm({
  employee,
  state,
  onDone,
}: {
  employee: Employee;
  state: Compensation;
  onDone: () => void;
}) {
  const { t } = useTranslation('employees');
  const errors = useEmployeeErrors();
  const messages = useMessages();
  const { data: user } = useCurrentUser();
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const save = useSetCompensation(employee.id);
  const form = useForm<CompensationFormValues>({
    resolver: zodResolver(compensationFormSchema),
    defaultValues: emptyCompensation(today, state.items.find((i) => i.current) ?? state.items[0]),
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-3"
      aria-label={t('compensation.form')}
      onSubmit={form.handleSubmit((v) =>
        save.mutate(toCompensationRequest(v), { onSuccess: onDone }),
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('compensation.validFrom')}
          error={messages.validation(e.validFrom)}
          hint={t('compensation.validFromHint')}
        >
          {(field) => <Input {...field} type="date" {...form.register('validFrom')} />}
        </Field>
        <Field label={t('compensation.basisLabel')}>
          {(field) => (
            <Select {...field} {...form.register('basis')}>
              {COMPENSATION_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {t(`compensation.basis.${basis}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('compensation.amountLabel')}
          error={messages.validation(e.amount)}
          hint={t('compensation.amountHint')}
        >
          {(field) => (
            <Input {...field} inputMode="decimal" autoComplete="off" {...form.register('amount')} />
          )}
        </Field>
        <Field label={t('compensation.currency')}>
          {(field) => (
            <Select {...field} {...form.register('currency')}>
              {COMPENSATION_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('compensation.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('compensation.cancel')}
        </Button>
      </div>
      {save.isError && <Alert tone="danger">{errors.apiError(save.error)}</Alert>}
    </form>
  );
}
