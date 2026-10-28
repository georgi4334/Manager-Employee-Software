import {
  MIN_GROUP_SIZE,
  addDays,
  formatDuration,
  todayIn,
  type Analytics,
} from '@intime/contracts';
import { Briefcase, Building2, CalendarOff, Clock, ListChecks, Timer, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useTypeName } from '@/features/leave/names';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton, SkeletonCard, SkeletonGroup, SkeletonStatCard } from '@/shared/ui/skeleton';
import { TabList } from '@/shared/ui/tabs';
import { Bars as Columns, StatCard } from '@/features/dashboard/ui';
import { useAnalytics } from './hooks';
import { Bars, NoData, Section, Stat, Stats, Suppressed } from './parts';

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="w-full space-y-1 sm:w-auto">
          <TabList
            mode="toggle"
            label={t('period.label')}
            tabs={PERIODS.map((d) => ({
              name: String(d),
              label: t('period.lastDays', { count: d }),
            }))}
            value={String(days)}
            onChange={(name) => setDays(Number(name) as (typeof PERIODS)[number])}
          />
          <p className="text-right text-xs text-muted-foreground">
            {t('period.range', { from: formatDay(from, language), to: formatDay(today, language) })}
          </p>
        </div>
      </div>

      {query.isPending && (
        <SkeletonGroup label={t('loading')} className="space-y-4">
          <Skeleton className="h-4 w-56 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonStatCard key={i} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard className="lg:col-span-2" rows={5} />
          </div>
        </SkeletonGroup>
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t('summary.people')}
          icon={Users}
          tone="success"
          value={num(people.headcount)}
          note={t('summary.peopleNote', { hires: num(people.hires), leavers: num(people.leavers) })}
        />
        <StatCard
          title={t('summary.absence')}
          icon={CalendarOff}
          tone="warning"
          value={num(absence.days)}
          note={t('summary.absenceNote', { count: absence.pendingRequests })}
        />
        <StatCard
          title={t('summary.hours')}
          icon={Timer}
          tone="primary"
          value={hours(time.loggedMinutes)}
          note={t('summary.hoursNote', { percent: percent(time.billablePercent) })}
          trend={time.weeks.map((w) => w.minutes)}
        />
        <StatCard
          title={t('summary.tasks')}
          icon={ListChecks}
          tone="info"
          value={num(projects.openTasks)}
          note={t('summary.tasksNote', { count: projects.overdueTasks })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="an-people" title={t('people.title')} icon={Users}>
          <Stats>
            <Stat label={t('people.headcount')} value={num(people.headcount)} />
            <Stat label={t('people.hires')} value={num(people.hires)} />
            <Stat label={t('people.leavers')} value={num(people.leavers)} />
          </Stats>
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
        </Section>

        <Section id="an-absence" title={t('absence.title')} icon={CalendarOff}>
          <Stats>
            <Stat label={t('absence.days')} value={num(absence.days)} />
            <Stat
              label={t('absence.perPerson')}
              value={absence.daysPerPerson === null ? t('none') : num(absence.daysPerPerson)}
            />
            <Stat label={t('absence.pending')} value={num(absence.pendingRequests)} />
          </Stats>
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

        <Section id="an-time" title={t('time.title')} icon={Timer} className="lg:col-span-2">
          <Stats>
            <Stat label={t('time.logged')} value={hours(time.loggedMinutes)} />
            <Stat label={t('time.billable')} value={percent(time.billablePercent)} />
            <Stat label={t('time.approved')} value={percent(time.approvedPercent)} />
          </Stats>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t('time.perWeek')}</h3>
              {time.weeks.length > 0 ? (
                <Columns
                  items={time.weeks.map((w) => ({
                    key: w.weekStart,
                    label: formatDay(w.weekStart, language, { day: 'numeric', month: 'short' }),
                    value: w.minutes,
                    text: hours(w.minutes),
                  }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              )}
            </div>
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

        <Section id="an-attendance" title={t('attendance.title')} icon={Clock}>
          <Stats className="sm:grid-cols-2">
            <Stat label={t('attendance.records')} value={num(attendance.records)} />
            <Stat label={t('attendance.worked')} value={hours(attendance.workedMinutes)} />
          </Stats>
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

        <Section id="an-projects" title={t('projects.title')} icon={Briefcase}>
          <Stats className="sm:grid-cols-2">
            <Stat label={t('projects.openTasks')} value={num(projects.openTasks)} />
            <Stat label={t('projects.overdueTasks')} value={num(projects.overdueTasks)} />
            <Stat label={t('projects.budgetWarning')} value={num(projects.budgetWarning)} />
            <Stat label={t('projects.budgetOver')} value={num(projects.budgetOver)} />
          </Stats>
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
          <Section
            id="an-company"
            title={t('company.title')}
            icon={Building2}
            className="lg:col-span-2"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <Stats className="sm:grid-cols-2">
                  <Stat label={t('company.goalsOverdue')} value={num(company.goals.overdue)} />
                </Stats>
                <Bars
                  title={t('company.goals')}
                  bars={company.goals.byStatus.map((s) => ({
                    key: s.status,
                    label: t(`goalStatus.${s.status}`),
                    value: s.count,
                    text: num(s.count),
                  }))}
                />
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
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
