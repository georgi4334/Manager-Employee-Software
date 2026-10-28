import {
  addDays,
  formatDuration,
  todayIn,
  weekStartOf,
  type DashboardWidget,
  type GrantedPermissions,
} from '@intime/contracts';
import {
  Archive,
  Award,
  Bell,
  CalendarDays,
  CalendarOff,
  ChartColumn,
  ClipboardCheck,
  Clock,
  Gauge,
  Inbox,
  ListChecks,
  MessageSquareText,
  MessagesSquare,
  Network,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Briefcase,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatus } from '@/features/assistant/hooks';
import { useAttendanceStatus, usePresence } from '@/features/attendance/hooks';
import { userHasPermission, type PermissionRequirement } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useEvents } from '@/features/calendar/hooks';
import { useCapacity } from '@/features/capacity/hooks';
import { useEmployees, useOwnEmployee } from '@/features/employees/hooks';
import { useFeedback } from '@/features/feedback/hooks';
import { useGoals } from '@/features/goals/hooks';
import { useBalances, useLeaveRequests, useLeaveTypes } from '@/features/leave/hooks';
import { useTypeName } from '@/features/leave/names';
import { NotificationText } from '@/features/notifications/NotificationText';
import { useNotifications } from '@/features/notifications/hooks';
import { useMeetings } from '@/features/one-on-ones/hooks';
import { useDepartments, useTeams } from '@/features/organization/hooks';
import { useProjects } from '@/features/projects/hooks';
import { useRetention } from '@/features/retention/hooks';
import { useReviews } from '@/features/reviews/hooks';
import { useRoles } from '@/features/roles/hooks';
import { usePerson } from '@/features/skills/hooks';
import { useTasks } from '@/features/tasks/hooks';
import { useWeek } from '@/features/time/hooks';
import { useAnalytics } from '@/features/analytics/hooks';
import { SkeletonLines } from '@/shared/ui/skeleton';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { Bars, Meter, Muted, Pill, Row, Rows, StatCard, WidgetCard, type Tone } from './ui';

export type WidgetSize = 'stat' | 'card' | 'wide';

export interface WidgetDef {
  id: DashboardWidget;
  size: WidgetSize;
  icon: LucideIcon;
  /** Who can use the widget (cosmetic: every request it makes is checked by the server). */
  permission?: PermissionRequirement;
  Component: () => ReactNode;
}

function useToday() {
  const { data: user } = useCurrentUser();
  return todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function useLang() {
  const { t, i18n } = useTranslation('dashboard');
  return { t, language: i18n.resolvedLanguage ?? 'en' };
}

/** Shows loading and error states the same way in every widget. */
function State({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean };
  children: ReactNode;
}) {
  const { t } = useTranslation('dashboard');
  if (query.isPending)
    return (
      <>
        <SkeletonLines />
        <span className="sr-only">{t('loading')}</span>
      </>
    );
  if (query.isError) return <Muted>{t('failed')}</Muted>;
  return <>{children}</>;
}

/* ---------- figures on top ---------- */

function Stat({
  id,
  icon,
  tone,
  to,
  query,
  value,
  note,
  trend,
}: {
  id: DashboardWidget;
  icon: LucideIcon;
  tone: Tone;
  to: string;
  query: { isPending: boolean; isError: boolean };
  value: ReactNode;
  note?: ReactNode;
  trend?: number[];
}) {
  const { t } = useLang();
  const shown = query.isPending ? '…' : query.isError ? '–' : value;
  return (
    <StatCard
      title={t(`widgets.${id}.title`)}
      icon={icon}
      tone={tone}
      to={to}
      value={shown}
      note={query.isPending || query.isError ? undefined : note}
      trend={query.isPending || query.isError ? undefined : trend}
    />
  );
}

function PresenceStat() {
  const { t } = useLang();
  const query = usePresence();
  const items = query.data?.items ?? [];
  const working = items.filter((i) => i.state === 'working').length;
  const away = items.filter((i) => i.state === 'leave').length;
  return (
    <Stat
      id="stat_presence"
      icon={UserCheck}
      tone="success"
      to="/attendance?tab=team"
      query={query}
      value={formatNumber(working, 'en')}
      note={t('widgets.stat_presence.note', { count: away })}
    />
  );
}

function ApprovalsStat() {
  const { t } = useLang();
  const query = useLeaveRequests({ status: 'pending', approvable: true, page: 1, pageSize: 1 });
  return (
    <Stat
      id="stat_approvals"
      icon={Inbox}
      tone="warning"
      to="/leave?tab=approvals"
      query={query}
      value={query.data?.total ?? 0}
      note={t('widgets.stat_approvals.note')}
    />
  );
}

function HoursStat() {
  const { t } = useLang();
  const today = useToday();
  const query = useWeek(weekStartOf(today));
  const week = query.data;
  return (
    <Stat
      id="stat_hours"
      icon={Timer}
      tone="primary"
      to="/time"
      query={query}
      value={formatDuration(week?.totalMinutes ?? 0)}
      note={t('widgets.stat_hours.note', { billable: formatDuration(week?.billableMinutes ?? 0) })}
      trend={week?.days.map((d) => d.minutes)}
    />
  );
}

/** Planned share of the available time, in whole percent (0 when nothing is available). */
const loadPercent = (planned: number, available: number) =>
  available > 0 ? Math.round((planned / available) * 100) : 0;

function WorkloadStat() {
  const { t } = useLang();
  const today = useToday();
  const from = weekStartOf(today);
  const query = useCapacity({ from, to: addDays(from, 6), projectId: '', q: '', page: 1 });
  const people = query.data?.items ?? [];
  const available = people.reduce((s, p) => s + p.availableMinutes, 0);
  const planned = people.reduce((s, p) => s + p.plannedMinutes, 0);
  const percent = loadPercent(planned, available);
  const level =
    available === 0 ? 'none' : percent > 100 ? 'over' : percent >= 85 ? 'busy' : 'balanced';
  const days = people[0]?.days.map((_, i) =>
    loadPercent(
      people.reduce((s, p) => s + (p.days[i]?.plannedMinutes ?? 0), 0),
      people.reduce((s, p) => s + (p.days[i]?.availableMinutes ?? 0), 0),
    ),
  );
  return (
    <Stat
      id="stat_workload"
      icon={Gauge}
      tone="info"
      to="/capacity"
      query={query}
      value={`${percent} %`}
      note={t(`widgets.stat_workload.level.${level}`)}
      trend={days}
    />
  );
}

function TasksStat() {
  const { t } = useLang();
  const query = useTasks({
    projectId: '',
    mine: true,
    status: 'open',
    type: 'all',
    q: '',
    page: 1,
    pageSize: 50,
  });
  const overdue = query.data?.items.filter((i) => i.overdue).length ?? 0;
  return (
    <Stat
      id="stat_tasks"
      icon={ListChecks}
      tone="primary"
      to="/tasks"
      query={query}
      value={query.data?.total ?? 0}
      note={t('widgets.stat_tasks.note', { count: overdue })}
    />
  );
}

/* ---------- cards ---------- */

function Card({
  id,
  icon,
  to,
  children,
}: {
  id: DashboardWidget;
  icon: LucideIcon;
  to?: string;
  children: ReactNode;
}) {
  const { t } = useLang();
  return (
    <WidgetCard title={t(`widgets.${id}.title`)} icon={icon} to={to}>
      {children}
    </WidgetCard>
  );
}

function AttendanceCard() {
  const { t } = useLang();
  const query = useAttendanceStatus();
  const status = query.data;
  return (
    <Card id="attendance" icon={Clock} to="/attendance">
      <State query={query}>
        {status && (
          <div className="space-y-2">
            <Pill tone={status.open ? 'accent' : 'muted'}>
              {status.open
                ? t('widgets.attendance.in', { time: status.open.startTime })
                : t('widgets.attendance.out')}
            </Pill>
            <p className="text-sm">
              {t('widgets.attendance.today', { duration: formatDuration(status.minutes ?? 0) })}
            </p>
          </div>
        )}
      </State>
    </Card>
  );
}

function LeaveCard() {
  const { t, language } = useLang();
  const today = useToday();
  const own = useOwnEmployee();
  const balances = useBalances(own.data?.id, Number(today.slice(0, 4)), Boolean(own.data));
  const types = useLeaveTypes();
  const typeName = useTypeName();
  const byId = new Map((types.data ?? []).map((ty) => [ty.id, ty]));
  return (
    <Card id="leave" icon={CalendarOff} to="/leave">
      <State query={own.data ? balances : own}>
        {(balances.data?.balances ?? []).length === 0 ? (
          <Muted>{t('widgets.leave.empty')}</Muted>
        ) : (
          <Rows>
            {(balances.data?.balances ?? []).map((b) => {
              const type = byId.get(b.leaveTypeId);
              return (
                <Row
                  key={b.leaveTypeId}
                  title={type ? typeName(type) : '—'}
                  aside={t('widgets.leave.left', {
                    count: b.remaining,
                    days: formatNumber(b.remaining, language),
                  })}
                />
              );
            })}
          </Rows>
        )}
      </State>
    </Card>
  );
}

function ApprovalsCard() {
  const { t, language } = useLang();
  const query = useLeaveRequests({ status: 'pending', approvable: true, page: 1, pageSize: 4 });
  return (
    <Card id="approvals" icon={Inbox} to="/leave?tab=approvals">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.map((r) => (
              <Row
                key={r.id}
                title={`${r.employee.firstName} ${r.employee.lastName}`}
                detail={`${formatDay(r.startDate, language)} – ${formatDay(r.endDate, language)}`}
                aside={t('widgets.approvals.days', {
                  count: r.days,
                  days: formatNumber(r.days, language),
                })}
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.approvals.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function CalendarCard() {
  const { t, language } = useLang();
  const today = useToday();
  const query = useEvents(today, addDays(today, 13));
  const items = (query.data?.items ?? []).slice(0, 5);
  return (
    <Card id="calendar" icon={CalendarDays} to="/calendar">
      <State query={query}>
        {items.length ? (
          <Rows>
            {items.map((e) => (
              <Row
                key={`${e.id}:${e.occurrenceDate}`}
                title={e.title}
                detail={formatDay(e.occurrenceDate ?? e.startDate, language, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
                aside={e.allDay ? t('widgets.calendar.allDay') : e.startTime}
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.calendar.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function ProjectsCard() {
  const { t } = useLang();
  const query = useProjects({ q: '', status: 'active', clientId: '', page: 1 });
  return (
    <Card id="projects" icon={Briefcase} to="/projects">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.slice(0, 4).map((p) => (
              <Row
                key={p.id}
                title={p.name}
                detail={p.code}
                aside={
                  p.health && (
                    <Pill tone={p.health === 'on_track' ? 'muted' : 'accent'}>
                      {t(`health.${p.health}`)}
                    </Pill>
                  )
                }
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.projects.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function TasksCard() {
  const { t, language } = useLang();
  const query = useTasks({
    projectId: '',
    mine: true,
    status: 'open',
    type: 'all',
    q: '',
    page: 1,
    pageSize: 5,
  });
  return (
    <Card id="tasks" icon={ListChecks} to="/tasks">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.map((task) => (
              <Row
                key={task.id}
                title={task.title}
                detail={
                  task.dueDate
                    ? `${task.key} · ${t('widgets.tasks.due', { date: formatDay(task.dueDate, language) })}`
                    : task.key
                }
                aside={
                  <Pill tone={task.overdue ? 'accent' : 'muted'}>
                    {t(`taskStatus.${task.status}`)}
                  </Pill>
                }
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.tasks.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function TimeCard() {
  const { t, language } = useLang();
  const today = useToday();
  const query = useWeek(weekStartOf(today));
  return (
    <Card id="time" icon={Timer} to="/time">
      <State query={query}>
        {query.data && (
          <div className="space-y-3">
            <p className="text-sm">
              {t('widgets.time.total', { duration: formatDuration(query.data.totalMinutes) })}
            </p>
            <Bars
              items={query.data.days.map((d) => ({
                key: d.date,
                label: formatDay(d.date, language, { weekday: 'short' }),
                value: d.minutes,
                text: formatDuration(d.minutes),
              }))}
            />
          </div>
        )}
      </State>
    </Card>
  );
}

function CapacityCard() {
  const { t } = useLang();
  const today = useToday();
  const from = weekStartOf(today);
  const query = useCapacity({ from, to: addDays(from, 6), projectId: '', q: '', page: 1 });
  const people = (query.data?.items ?? []).slice(0, 6);
  return (
    <Card id="capacity" icon={Gauge} to="/capacity">
      <State query={query}>
        {people.length ? (
          <ul>
            {people.map((p) => {
              const percent = loadPercent(p.plannedMinutes, p.availableMinutes);
              return (
                <Meter
                  key={p.employee.id}
                  label={`${p.employee.firstName} ${p.employee.lastName}`}
                  percent={percent}
                  text={t('widgets.capacity.planned', { percent })}
                />
              );
            })}
          </ul>
        ) : (
          <Muted>{t('widgets.capacity.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function GoalsCard() {
  const { t } = useLang();
  const query = useGoals({ scope: 'all', status: 'open', q: '', page: 1, pageSize: 4 });
  return (
    <Card id="goals" icon={Target} to="/goals">
      <State query={query}>
        {query.data?.items.length ? (
          <ul>
            {query.data.items.map((g) => (
              <Meter
                key={g.id}
                label={g.title}
                percent={g.progressPct}
                text={t('widgets.goals.progress', { percent: g.progressPct })}
              />
            ))}
          </ul>
        ) : (
          <Muted>{t('widgets.goals.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function OneOnOnesCard() {
  const { t, language } = useLang();
  const query = useMeetings({ status: 'upcoming', page: 1 });
  return (
    <Card id="one_on_ones" icon={MessagesSquare} to="/one-on-ones">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.slice(0, 4).map((m) => (
              <Row
                key={m.id}
                title={`${m.other.firstName} ${m.other.lastName}`}
                detail={formatDay(m.date, language, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
                aside={m.time}
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.one_on_ones.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function FeedbackCard() {
  const { t, language } = useLang();
  const query = useFeedback({ box: 'received', employeeId: '', page: 1 });
  return (
    <Card id="feedback" icon={MessageSquareText} to="/feedback">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.slice(0, 3).map((f) => (
              <Row
                key={f.id}
                title={`${f.from.firstName} ${f.from.lastName}`}
                detail={formatDay(f.createdAt.slice(0, 10), language)}
                aside={
                  <Pill tone={f.kind === 'praise' ? 'accent' : 'muted'}>
                    {t(`feedbackKind.${f.kind}`)}
                  </Pill>
                }
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.feedback.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function SkillsCard() {
  const { t, language } = useLang();
  const own = useOwnEmployee();
  const query = usePerson(own.data?.id ?? '', Boolean(own.data));
  const ratings = query.data?.ratings ?? [];
  const average = ratings.length ? ratings.reduce((s, r) => s + r.level, 0) / ratings.length : 0;
  return (
    <Card id="skills" icon={Award} to="/skills">
      <State query={own.data ? query : own}>
        {ratings.length ? (
          <div className="space-y-1">
            <p className="text-2xl font-semibold">{ratings.length}</p>
            <Muted>
              {t('widgets.skills.summary', {
                count: ratings.length,
                level: formatNumber(average, language, { maximumFractionDigits: 1 }),
              })}
            </Muted>
          </div>
        ) : (
          <Muted>{t('widgets.skills.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function ReviewsCard() {
  const { t } = useLang();
  const query = useReviews({ box: 'mine', cycleId: '', page: 1 });
  return (
    <Card id="reviews" icon={ClipboardCheck} to="/reviews">
      <State query={query}>
        {query.data?.items.length ? (
          <Rows>
            {query.data.items.slice(0, 3).map((r) => (
              <Row
                key={r.id}
                title={r.cycle.name}
                aside={
                  <Pill tone={r.released ? 'accent' : 'muted'}>
                    {t(
                      r.released
                        ? 'widgets.reviews.released'
                        : r.selfSubmitted
                          ? 'widgets.reviews.submitted'
                          : 'widgets.reviews.todo',
                    )}
                  </Pill>
                }
              />
            ))}
          </Rows>
        ) : (
          <Muted>{t('widgets.reviews.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

function AnalyticsCard() {
  const { t, language } = useLang();
  const today = useToday();
  const query = useAnalytics(addDays(today, -55), today);
  const data = query.data;
  return (
    <Card id="analytics" icon={ChartColumn} to="/analytics">
      <State query={query}>
        {data && (
          <div className="space-y-3">
            <p className="text-sm">
              {t('widgets.analytics.summary', {
                people: formatNumber(data.people.headcount, language),
                days: formatNumber(data.absence.days, language),
              })}
            </p>
            <Bars
              items={data.time.weeks.map((w) => ({
                key: w.weekStart,
                label: formatDay(w.weekStart, language, { day: 'numeric', month: 'short' }),
                value: w.minutes,
                text: formatDuration(w.minutes),
              }))}
            />
          </div>
        )}
      </State>
    </Card>
  );
}

function AssistantCard() {
  const { t } = useLang();
  const query = useAiStatus();
  return (
    <WidgetCard
      title={t('widgets.assistant.title')}
      icon={Sparkles}
      to="/assistant"
      linkText={t('widgets.assistant.open')}
    >
      <State query={query}>
        <Muted>{t(query.data?.enabled ? 'widgets.assistant.on' : 'widgets.assistant.off')}</Muted>
      </State>
    </WidgetCard>
  );
}

function RetentionCard() {
  const { t } = useLang();
  const query = useRetention();
  const due = query.data?.candidates.filter((c) => c.due).length ?? 0;
  return (
    <Card id="retention" icon={Archive} to="/retention">
      <State query={query}>
        <div className="space-y-2">
          <Pill tone={query.data?.policy.enabled ? 'accent' : 'muted'}>
            {t(query.data?.policy.enabled ? 'widgets.retention.on' : 'widgets.retention.off')}
          </Pill>
          <Muted>{t('widgets.retention.due', { count: due })}</Muted>
        </div>
      </State>
    </Card>
  );
}

function RolesCard() {
  const { t } = useLang();
  const query = useRoles();
  return (
    <Card id="roles" icon={ShieldCheck} to="/roles">
      <State query={query}>
        <Rows>
          {(query.data ?? []).slice(0, 5).map((r) => (
            <Row
              key={r.id}
              title={r.name}
              aside={t('widgets.roles.people', { count: r.userCount })}
            />
          ))}
        </Rows>
      </State>
    </Card>
  );
}

function EmployeesCard() {
  const { t, language } = useLang();
  const query = useEmployees({ q: '', status: 'active', page: 1 });
  const people = query.data?.items ?? [];
  return (
    <Card id="employees" icon={Users} to="/employees">
      <State query={query}>
        <div className="space-y-3">
          <p className="text-sm">
            {t('widgets.employees.active', {
              count: query.data?.total ?? 0,
              total: formatNumber(query.data?.total ?? 0, language),
            })}
          </p>
          <ul className="flex -space-x-2" aria-hidden="true">
            {people.slice(0, 6).map((p) => (
              <li
                key={p.id}
                className="grid size-9 place-items-center rounded-full border-2 border-surface bg-accent text-xs font-semibold text-accent-foreground"
              >
                {`${p.firstName.charAt(0)}${p.lastName.charAt(0)}`}
              </li>
            ))}
          </ul>
        </div>
      </State>
    </Card>
  );
}

function OrganizationCard() {
  const { t, language } = useLang();
  const departments = useDepartments();
  const teams = useTeams();
  return (
    <Card id="organization" icon={Network} to="/organization">
      <State
        query={{
          isPending: departments.isPending || teams.isPending,
          isError: departments.isError || teams.isError,
        }}
      >
        <Rows>
          <Row
            title={t('widgets.organization.departments')}
            aside={formatNumber(departments.data?.length ?? 0, language)}
          />
          <Row
            title={t('widgets.organization.teams')}
            aside={formatNumber(teams.data?.length ?? 0, language)}
          />
        </Rows>
      </State>
    </Card>
  );
}

function NotificationsCard() {
  const { t } = useLang();
  const query = useNotifications();
  const items = query.data?.pages[0]?.items.slice(0, 4) ?? [];
  return (
    <Card id="notifications" icon={Bell} to="/notifications">
      <State query={query}>
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id} className="py-2.5 text-sm">
                <NotificationText type={n.type} params={n.params} />
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{t('widgets.notifications.empty')}</Muted>
        )}
      </State>
    </Card>
  );
}

export const WIDGETS: Record<DashboardWidget, WidgetDef> = {
  stat_presence: {
    id: 'stat_presence',
    size: 'stat',
    icon: UserCheck,
    permission: 'attendance.view',
    Component: PresenceStat,
  },
  stat_approvals: {
    id: 'stat_approvals',
    size: 'stat',
    icon: Inbox,
    permission: 'leave.approve',
    Component: ApprovalsStat,
  },
  stat_hours: {
    id: 'stat_hours',
    size: 'stat',
    icon: Timer,
    permission: 'time.log',
    Component: HoursStat,
  },
  stat_workload: {
    id: 'stat_workload',
    size: 'stat',
    icon: Gauge,
    permission: 'capacity.view',
    Component: WorkloadStat,
  },
  stat_tasks: {
    id: 'stat_tasks',
    size: 'stat',
    icon: ListChecks,
    permission: 'task.view',
    Component: TasksStat,
  },
  attendance: {
    id: 'attendance',
    size: 'card',
    icon: Clock,
    permission: 'attendance.record',
    Component: AttendanceCard,
  },
  leave: {
    id: 'leave',
    size: 'card',
    icon: CalendarOff,
    permission: 'leave.request',
    Component: LeaveCard,
  },
  approvals: {
    id: 'approvals',
    size: 'card',
    icon: Inbox,
    permission: 'leave.approve',
    Component: ApprovalsCard,
  },
  calendar: {
    id: 'calendar',
    size: 'card',
    icon: CalendarDays,
    permission: 'calendar.manage_own',
    Component: CalendarCard,
  },
  projects: {
    id: 'projects',
    size: 'card',
    icon: Briefcase,
    permission: 'project.view',
    Component: ProjectsCard,
  },
  tasks: {
    id: 'tasks',
    size: 'card',
    icon: ListChecks,
    permission: 'task.view',
    Component: TasksCard,
  },
  time: { id: 'time', size: 'wide', icon: Timer, permission: 'time.log', Component: TimeCard },
  capacity: {
    id: 'capacity',
    size: 'wide',
    icon: Gauge,
    permission: 'capacity.view',
    Component: CapacityCard,
  },
  goals: { id: 'goals', size: 'card', icon: Target, permission: 'goal.view', Component: GoalsCard },
  one_on_ones: {
    id: 'one_on_ones',
    size: 'card',
    icon: MessagesSquare,
    permission: 'one_on_one.manage',
    Component: OneOnOnesCard,
  },
  feedback: {
    id: 'feedback',
    size: 'card',
    icon: MessageSquareText,
    permission: 'feedback.give',
    Component: FeedbackCard,
  },
  skills: {
    id: 'skills',
    size: 'card',
    icon: Award,
    permission: 'skill.view',
    Component: SkillsCard,
  },
  reviews: {
    id: 'reviews',
    size: 'card',
    icon: ClipboardCheck,
    permission: 'review.view',
    Component: ReviewsCard,
  },
  analytics: {
    id: 'analytics',
    size: 'wide',
    icon: ChartColumn,
    permission: 'analytics.view_team',
    Component: AnalyticsCard,
  },
  assistant: {
    id: 'assistant',
    size: 'card',
    icon: Sparkles,
    permission: 'ai.use',
    Component: AssistantCard,
  },
  retention: {
    id: 'retention',
    size: 'card',
    icon: Archive,
    permission: 'gdpr.manage_retention',
    Component: RetentionCard,
  },
  roles: {
    id: 'roles',
    size: 'card',
    icon: ShieldCheck,
    permission: 'admin.role.view',
    Component: RolesCard,
  },
  employees: {
    id: 'employees',
    size: 'card',
    icon: Users,
    permission: 'employee.view_directory',
    Component: EmployeesCard,
  },
  organization: {
    id: 'organization',
    size: 'card',
    icon: Network,
    permission: 'org.view',
    Component: OrganizationCard,
  },
  notifications: { id: 'notifications', size: 'card', icon: Bell, Component: NotificationsCard },
};

export const canUse = (widget: WidgetDef, granted: GrantedPermissions | undefined) =>
  !widget.permission || userHasPermission(granted, widget.permission);
