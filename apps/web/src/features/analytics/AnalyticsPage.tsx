import {
  MIN_GROUP_SIZE,
  addDays,
  formatDuration,
  todayIn,
  type Analytics,
} from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useTypeName } from '@/features/leave/names';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Select } from '@/shared/ui/select';
import { useAnalytics } from './hooks';
import { Bars, NoData, Section, Stat, Suppressed } from './parts';

const REVIEW_PARTS = ['total', 'selfSubmitted', 'managerSubmitted', 'released'] as const;
const PERIODS = [7, 30, 90, 365] as const;

export function AnalyticsPage() {
  const { t, i18n } = useTranslation('analytics');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const { data: user } = useCurrentUser();
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const from = addDays(today, -(days - 1));
  const query = useAnalytics(from, today);
  const data = query.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label htmlFor="analytics-period" className="text-sm font-medium">
          {t('period.label')}
        </label>
        <Select
          id="analytics-period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}
        >
          {PERIODS.map((d) => (
            <option key={d} value={d}>
              {t('period.lastDays', { count: d })}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('period.range', { from: formatDay(from, language), to: formatDay(today, language) })}
        </p>
      </div>

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data && <Dashboard data={data} language={language} />}
    </div>
  );
}

function Dashboard({ data, language }: { data: Analytics; language: string }) {
  const { t } = useTranslation('analytics');
  const typeName = useTypeName();
  const num = (value: number) => formatNumber(value, language);
  const hours = (minutes: number) => t('hours', { value: formatDuration(minutes) });
  const percent = (value: number | null) =>
    value === null ? t('none') : formatNumber(value / 100, language, { style: 'percent' });
  const { people, absence, attendance, time, projects, company } = data;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('population', { count: data.population })}
        {data.population < MIN_GROUP_SIZE && ` ${t('smallGroup', { count: MIN_GROUP_SIZE })}`}
      </p>

      <Section id="an-people" title={t('people.title')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t('people.headcount')} value={num(people.headcount)} />
          <Stat label={t('people.hires')} value={num(people.hires)} />
          <Stat label={t('people.leavers')} value={num(people.leavers)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {people.byDepartment ? (
            <Bars
              title={t('people.byDepartment')}
              bars={people.byDepartment.map((d) => ({
                key: d.id ?? 'none',
                label: d.name ?? t('people.noDepartment'),
                value: d.count,
                text: num(d.count),
              }))}
            />
          ) : (
            <Suppressed title={t('people.byDepartment')} />
          )}
          {people.byEmploymentType ? (
            <Bars
              title={t('people.byEmploymentType')}
              bars={people.byEmploymentType.map((r) => ({
                key: r.type,
                label: t(`employmentType.${r.type}`),
                value: r.count,
                text: num(r.count),
              }))}
            />
          ) : (
            <Suppressed title={t('people.byEmploymentType')} />
          )}
        </div>
      </Section>

      <Section id="an-absence" title={t('absence.title')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t('absence.days')} value={num(absence.days)} />
          <Stat
            label={t('absence.perPerson')}
            value={absence.daysPerPerson === null ? t('none') : num(absence.daysPerPerson)}
          />
          <Stat label={t('absence.pending')} value={num(absence.pendingRequests)} />
        </div>
        {absence.byType ? (
          absence.byType.length > 0 ? (
            <Bars
              title={t('absence.byType')}
              bars={absence.byType.map((r) => ({
                key: r.key ?? r.name ?? 'type',
                label: typeName(r),
                value: r.days,
                text: t('days', { count: r.days, formattedCount: num(r.days) }),
              }))}
            />
          ) : (
            <NoData title={t('absence.byType')} />
          )
        ) : (
          <Suppressed title={t('absence.byType')} />
        )}
      </Section>

      <Section id="an-attendance" title={t('attendance.title')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat label={t('attendance.records')} value={num(attendance.records)} />
          <Stat label={t('attendance.worked')} value={hours(attendance.workedMinutes)} />
        </div>
        {attendance.byMode ? (
          attendance.byMode.length > 0 ? (
            <Bars
              title={t('attendance.byMode')}
              bars={attendance.byMode.map((r) => ({
                key: r.mode,
                label: t(`mode.${r.mode}`),
                value: r.records,
                text: num(r.records),
              }))}
            />
          ) : (
            <NoData title={t('attendance.byMode')} />
          )
        ) : (
          <Suppressed title={t('attendance.byMode')} />
        )}
      </Section>

      <Section id="an-time" title={t('time.title')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t('time.logged')} value={hours(time.loggedMinutes)} />
          <Stat label={t('time.billable')} value={percent(time.billablePercent)} />
          <Stat label={t('time.approved')} value={percent(time.approvedPercent)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Bars
            title={t('time.perWeek')}
            bars={time.weeks.map((w) => ({
              key: w.weekStart,
              label: t('time.weekOf', { date: formatDay(w.weekStart, language) }),
              value: w.minutes,
              text: hours(w.minutes),
            }))}
          />
          {time.topProjects.length > 0 ? (
            <Bars
              title={t('time.topProjects')}
              bars={time.topProjects.map((p) => ({
                key: p.id,
                label: `${p.code} · ${p.name}`,
                value: p.minutes,
                text: hours(p.minutes),
              }))}
            />
          ) : (
            <NoData title={t('time.topProjects')} />
          )}
        </div>
      </Section>

      <Section id="an-projects" title={t('projects.title')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('projects.openTasks')} value={num(projects.openTasks)} />
          <Stat label={t('projects.overdueTasks')} value={num(projects.overdueTasks)} />
          <Stat label={t('projects.budgetWarning')} value={num(projects.budgetWarning)} />
          <Stat label={t('projects.budgetOver')} value={num(projects.budgetOver)} />
        </div>
        <Bars
          title={t('projects.byStatus')}
          bars={projects.byStatus.map((s) => ({
            key: s.status,
            label: t(`projectStatus.${s.status}`),
            value: s.count,
            text: num(s.count),
          }))}
        />
      </Section>

      {company && (
        <Section id="an-company" title={t('company.title')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Bars
              title={t('company.goals')}
              bars={company.goals.byStatus.map((s) => ({
                key: s.status,
                label: t(`goalStatus.${s.status}`),
                value: s.count,
                text: num(s.count),
              }))}
            />
            <Stat label={t('company.goalsOverdue')} value={num(company.goals.overdue)} />
          </div>
          {company.reviews ? (
            <Bars
              title={t('company.reviews', { name: company.reviews.name })}
              bars={REVIEW_PARTS.map((key) => ({
                key,
                label: t(`company.review.${key}`),
                value: company.reviews?.[key] ?? 0,
                text: num(company.reviews?.[key] ?? 0),
              }))}
            />
          ) : (
            <NoData title={t('company.reviewsNone')} />
          )}
        </Section>
      )}
    </>
  );
}
