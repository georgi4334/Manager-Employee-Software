import { zodResolver } from '@hookform/resolvers/zod';
import {
  MAX_RETENTION_MONTHS,
  MIN_RETENTION_MONTHS,
  type RetentionOverview,
} from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePrivacyErrors } from '@/features/privacy/use-privacy-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { formatDate, formatDay } from '@/shared/lib/format';
import { periodFormSchema, type PeriodFormValues } from './forms';
import { useRetention, useSaveRetention, useSetHold } from './hooks';

export function RetentionPage() {
  const { t } = useTranslation('privacy');
  const errors = usePrivacyErrors();
  const query = useRetention();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('retention.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('retention.intro')}</p>
      <Alert tone="info">{t('retention.notLegalAdvice')}</Alert>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('retention.loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retention.retry')}</Button>
        </Card>
      )}
      {query.data && (
        <>
          <PolicyCard overview={query.data} />
          <Card className="space-y-2">
            <h2 className="text-lg font-semibold">{t('retention.whatTitle')}</h2>
            <p className="text-sm">{t('retention.whatErased')}</p>
            <p className="text-sm text-muted-foreground">{t('retention.whatStays')}</p>
          </Card>
          <Upcoming overview={query.data} />
        </>
      )}
    </div>
  );
}

function PolicyCard({ overview }: { overview: RetentionOverview }) {
  const { t, i18n } = useTranslation('privacy');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = usePrivacyErrors();
  const messages = useMessages();
  const save = useSaveRetention();
  const [confirming, setConfirming] = useState(false);
  const { policy } = overview;
  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: { months: String(policy.formerEmployeeMonths) },
  });

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">{t('retention.policyTitle')}</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('retention.country')}</dt>
          <dd className="font-medium">{t('retention.countryBG')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('retention.status')}</dt>
          <dd className="font-medium">{policy.enabled ? t('retention.on') : t('retention.off')}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t('retention.lastRun')}</dt>
          <dd className="font-medium">
            {policy.lastRunAt
              ? t('retention.lastRunValue', {
                  date: formatDate(policy.lastRunAt, language),
                  count: policy.lastRunErased,
                })
              : t('retention.neverRun')}
          </dd>
        </div>
      </dl>

      {policy.enabled ? (
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => save.mutate({ enabled: false })}
        >
          {t('retention.turnOff')}
        </Button>
      ) : confirming ? (
        <div className="space-y-2">
          <Alert tone="danger">
            {t('retention.confirmOn', { months: policy.formerEmployeeMonths })}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ enabled: true }, { onSuccess: () => setConfirming(false) })
              }
            >
              {t('retention.confirmButton')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('retention.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>{t('retention.turnOn')}</Button>
      )}

      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        aria-label={t('retention.periodForm')}
        onSubmit={form.handleSubmit((v) => save.mutate({ formerEmployeeMonths: Number(v.months) }))}
      >
        <Field
          label={t('retention.months')}
          hint={t('retention.monthsHint', {
            min: MIN_RETENTION_MONTHS,
            max: MAX_RETENTION_MONTHS,
            preset: policy.presetMonths,
          })}
          error={messages.validation(form.formState.errors.months)}
        >
          {(field) => (
            <Input {...field} inputMode="numeric" className="w-32" {...form.register('months')} />
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          {t('retention.savePeriod')}
        </Button>
      </form>
      {save.isError && <Alert tone="danger">{errors.apiError(save.error)}</Alert>}
    </Card>
  );
}

function Upcoming({ overview }: { overview: RetentionOverview }) {
  const { t, i18n } = useTranslation('privacy');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = usePrivacyErrors();
  const hold = useSetHold();

  return (
    <section aria-labelledby="retention-upcoming" className="space-y-2">
      <h2 id="retention-upcoming" className="text-lg font-semibold">
        {t('retention.upcomingTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('retention.upcomingIntro')}</p>
      {overview.candidates.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('retention.none')}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {overview.candidates.map((c) => (
            <li
              key={c.employeeId}
              className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{c.name}</p>
                <span className="flex flex-wrap gap-1">
                  {c.held ? (
                    <span className="rounded-full border border-info px-2 py-0.5 text-xs text-info">
                      {t('retention.heldBadge')}
                    </span>
                  ) : c.due ? (
                    <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">
                      {t('retention.dueBadge')}
                    </span>
                  ) : null}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('retention.dates', {
                  left: formatDay(c.terminationDate, language),
                  due: formatDay(c.dueDate, language),
                })}
              </p>
              <Button
                variant="secondary"
                disabled={hold.isPending}
                aria-label={t(c.held ? 'retention.releaseFor' : 'retention.holdFor', {
                  name: c.name,
                })}
                onClick={() => hold.mutate({ employeeId: c.employeeId, held: !c.held })}
              >
                {c.held ? t('retention.release') : t('retention.hold')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hold.isError && <Alert tone="danger">{errors.apiError(hold.error)}</Alert>}
      {overview.withoutTerminationDate > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('retention.withoutDate', { count: overview.withoutTerminationDate })}
        </p>
      )}
    </section>
  );
}
