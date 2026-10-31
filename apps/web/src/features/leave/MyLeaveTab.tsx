import { zodResolver } from '@hookform/resolvers/zod';
import type { LeaveType } from '@intime/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { useOwnEmployee } from '@/features/employees/hooks';
import { isApiError } from '@/shared/api/api-error';
import { formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Capsule } from '@/shared/ui/progress';
import { Select } from '@/shared/ui/select';
import { requestFormSchema, toPreview, toRequest, type RequestFormValues } from './forms';
import {
  useBalances,
  useCreateRequest,
  useLeaveRequests,
  useLeaveTypes,
  usePreviewRequest,
} from './hooks';
import { useTypeName } from './names';
import { RequestRow } from './RequestRow';
import { useLeaveErrors } from './use-leave-errors';

const PREVIEW_DELAY_MS = 400;
const EMPTY: RequestFormValues = {
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  halfDayStart: false,
  halfDayEnd: false,
  reason: '',
};

export function MyLeaveTab({ currentYear }: { currentYear: number }) {
  const { t } = useTranslation(['leave', 'common']);
  const own = useOwnEmployee();
  if (own.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (own.isError) {
    return isApiError(own.error, 'NOT_FOUND') ? (
      <Alert tone="info">{t('noRecord')}</Alert>
    ) : (
      <Alert tone="danger">{t('common:connectionProblemText')}</Alert>
    );
  }
  return (
    <div className="space-y-4">
      <BalanceCards currentYear={currentYear} />
      <RequestForm />
      <MyRequests employeeId={own.data.id} />
    </div>
  );
}

function BalanceCards({ currentYear }: { currentYear: number }) {
  const { t, i18n } = useTranslation('leave');
  const language = i18n.resolvedLanguage ?? 'en';
  const typeName = useTypeName();
  const types = useLeaveTypes();
  const [year, setYear] = useState(currentYear);
  const balances = useBalances(undefined, year);
  const nameOf = useMemo(
    () => new Map((types.data ?? []).map((type) => [type.id, type])),
    [types.data],
  );
  const n = (value: number) => formatNumber(value, language);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('balance.title')}</CardTitle>
        <div className="flex items-center gap-1" role="group" aria-label={t('balance.year')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('balance.previousYear')}
            onClick={() => setYear((y) => y - 1)}
          >
            ‹
          </Button>
          <span className="min-w-12 text-center text-sm font-medium">{year}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('balance.nextYear')}
            onClick={() => setYear((y) => y + 1)}
          >
            ›
          </Button>
        </div>
      </div>
      {balances.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {balances.data && balances.data.balances.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('balance.empty')}</p>
      )}
      {balances.data?.balances.map((balance) => {
        const type = nameOf.get(balance.leaveTypeId);
        return (
          <div key={balance.leaveTypeId} className="space-y-2">
            <p className="font-medium">{type ? typeName(type) : ''}</p>
            <p
              className="text-3xl font-semibold"
              aria-label={`${t('balance.remaining')}: ${n(balance.remaining)}`}
            >
              {n(balance.remaining)}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                {t('balance.remaining')}
              </span>
            </p>
            {(() => {
              const total = balance.entitled + balance.carriedOver + balance.adjustment;
              if (total <= 0) return null;
              return (
                <div aria-hidden="true">
                  <Capsule
                    className="max-w-md"
                    percent={(balance.used / total) * 100}
                    tone="info"
                    inside={t('balance.usedCount', { value: n(balance.used) })}
                    after={
                      balance.remaining > 0
                        ? t('balance.leftCount', { value: n(balance.remaining) })
                        : undefined
                    }
                  />
                </div>
              );
            })()}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
              {(
                [
                  ['entitled', balance.entitled],
                  ['carriedOver', balance.carriedOver],
                  ['adjustment', balance.adjustment],
                  ['used', balance.used],
                  ['pending', balance.pending],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-muted-foreground">{t(`balance.${key}`)}</dt>
                  <dd>{n(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </Card>
  );
}

function RequestForm() {
  const { t, i18n } = useTranslation('leave');
  const messages = useMessages();
  const errors = useLeaveErrors();
  const language = i18n.resolvedLanguage ?? 'en';
  const typeName = useTypeName();
  const types = useLeaveTypes();
  const create = useCreateRequest();
  const preview = usePreviewRequest();
  const [notice, setNotice] = useState<string | null>(null);
  const active = (types.data ?? []).filter((type) => type.isActive);
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: EMPTY,
  });
  const values = useWatch({ control: form.control }) as RequestFormValues;
  const selected: LeaveType | undefined = active.find((type) => type.id === values.leaveTypeId);
  const fieldErrors = form.formState.errors;

  // Live feedback: how many days this will count and what is left, once the dates make sense.
  const ready =
    Boolean(values.leaveTypeId && values.startDate && values.endDate) &&
    values.endDate >= values.startDate &&
    !(values.startDate === values.endDate && values.halfDayStart && values.halfDayEnd);
  const key = ready ? JSON.stringify(toPreview(values)) : '';
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(
      () => preview.mutate(JSON.parse(key) as ReturnType<typeof toPreview>),
      PREVIEW_DELAY_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the form values
  }, [key]);
  const result = ready ? preview.data : undefined;

  const submit = (v: RequestFormValues) =>
    create.mutate(toRequest(v, selected?.isSick ?? false), {
      onSuccess: (request) => {
        setNotice(request.status === 'approved' ? t('form.sentApproved') : t('form.sentApproval'));
        form.reset({ ...EMPTY, leaveTypeId: v.leaveTypeId });
        preview.reset();
      },
    });

  return (
    <Card className="space-y-3">
      <CardTitle>{t('form.title')}</CardTitle>
      <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(submit)}>
        <div className="sm:col-span-2">
          <Field label={t('form.type')} error={messages.validation(fieldErrors.leaveTypeId)}>
            {(field) => (
              <Select {...field} {...form.register('leaveTypeId')}>
                <option value="">—</option>
                {active.map((type) => (
                  <option key={type.id} value={type.id}>
                    {typeName(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('form.from')} error={messages.validation(fieldErrors.startDate)}>
          {(field) => <Input {...field} type="date" {...form.register('startDate')} />}
        </Field>
        <Field label={t('form.to')} error={messages.validation(fieldErrors.endDate)}>
          {(field) => <Input {...field} type="date" {...form.register('endDate')} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" {...form.register('halfDayStart')} />
          {t('form.halfStart')}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" {...form.register('halfDayEnd')} />
          {t('form.halfEnd')}
        </label>
        {fieldErrors.halfDayEnd && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {messages.validation(fieldErrors.halfDayEnd)}
          </p>
        )}

        {selected?.isSick ? (
          <p className="text-sm text-muted-foreground sm:col-span-2">{t('form.sickNote')}</p>
        ) : (
          <div className="sm:col-span-2">
            <Field
              label={t('form.reason')}
              hint={t('form.reasonHint')}
              error={messages.validation(fieldErrors.reason)}
            >
              {(field) => (
                <Input {...field} maxLength={300} autoComplete="off" {...form.register('reason')} />
              )}
            </Field>
          </div>
        )}

        <div className="space-y-1 sm:col-span-2" aria-live="polite">
          {ready && preview.isPending && (
            <p className="text-sm text-muted-foreground">{t('form.preview.checking')}</p>
          )}
          {preview.isError && ready && (
            <Alert tone="danger">{errors.apiError(preview.error)}</Alert>
          )}
          {result && result.days === 0 && (
            <p className="text-sm text-danger">{t('form.preview.noDays')}</p>
          )}
          {result && result.days > 0 && (
            <>
              <p className="text-sm font-medium">
                {t('form.preview.counted', {
                  count: result.days,
                  formattedCount: formatNumber(result.days, language),
                })}
              </p>
              {result.remainingAfter !== null && (
                <p
                  className={
                    result.enough ? 'text-sm text-muted-foreground' : 'text-sm text-danger'
                  }
                >
                  {result.enough
                    ? t('form.preview.remainingAfter', {
                        value: formatNumber(result.remainingAfter, language),
                      })
                    : t('form.preview.notEnough')}
                </p>
              )}
            </>
          )}
        </div>

        {notice && (
          <div className="sm:col-span-2">
            <Alert tone="success">{notice}</Alert>
          </div>
        )}
        {create.isError && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{errors.apiError(create.error)}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" className="w-full sm:w-auto" disabled={create.isPending}>
            {create.isPending ? t('form.submitting') : t('form.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MyRequests({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation('leave');
  const errors = useLeaveErrors();
  const canView = usePermission('leave.view');
  const list = useLeaveRequests({ employeeId, page: 1, pageSize: 100 }, canView);
  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">{t('requests.mine')}</h2>
      {list.isPending && canView && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {list.isError && <Alert tone="danger">{errors.apiError(list.error)}</Alert>}
      {list.data && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('requests.empty')}</p>
        </Card>
      )}
      {items.length > 0 && (
        <ul className="space-y-2" aria-label={t('requests.list')}>
          {items.map((request) => (
            <RequestRow key={request.id} request={request} cancel />
          ))}
        </ul>
      )}
    </div>
  );
}
