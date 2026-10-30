import type { Employee } from '@intime/contracts';
import {
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatList } from '@/shared/lib/format';
import { EmployeeAvatar } from './EmployeeAvatar';

/**
 * The top of an employee page: a dark banner with status, name, number and title, the avatar across its edge and
 * the key facts with icons below. Only what the caller may see is shown (the API already left the rest out).
 */
export function ProfileHeader({
  employee,
  children,
}: {
  employee: Employee;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation('employees');
  const language = i18n.resolvedLanguage ?? 'en';
  const profile = employee.profile;
  const name = `${employee.firstName} ${employee.lastName}`;
  const hired = profile?.hireDate
    ? formatDate(`${profile.hireDate}T00:00:00Z`, language, { dateStyle: 'long', timeZone: 'UTC' })
    : null;

  return (
    <section aria-label={name} className="relative overflow-hidden rounded-xl glass">
      <div className="flex items-center gap-4 border-b-4 border-brand bg-sidebar px-4 py-5 text-sidebar-foreground sm:block sm:py-6 sm:pl-48 sm:pr-6">
        <EmployeeAvatar
          firstName={employee.firstName}
          lastName={employee.lastName}
          className="size-16 text-xl ring-4 ring-surface sm:absolute sm:left-8 sm:top-8 sm:size-32 sm:text-4xl"
        />
        <div className="min-w-0 space-y-1.5">
          <span
            className={cn(
              'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
              employee.status === 'active'
                ? 'bg-success text-success-foreground'
                : 'bg-secondary text-secondary-foreground',
            )}
          >
            {t(`status.${employee.status}`)}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold sm:text-3xl">{name}</h1>
            {profile?.employeeNo && (
              <span className="text-sm font-medium text-sidebar-muted">
                {t('header.number', { number: profile.employeeNo })}
              </span>
            )}
          </div>
          {employee.jobTitle && (
            <p className="break-words text-sm text-sidebar-muted sm:text-base">
              {employee.jobTitle}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-4 px-4 py-4 sm:min-h-28 sm:pl-48 sm:pr-6">
        <ul
          aria-label={t('header.facts')}
          className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3"
        >
          {employee.location && <Fact icon={MapPin}>{employee.location}</Fact>}
          {employee.department && <Fact icon={Building2}>{employee.department.name}</Fact>}
          {hired && <Fact icon={CalendarDays}>{t('header.employed', { date: hired })}</Fact>}
          {employee.email && (
            <Fact icon={Mail}>
              <a href={`mailto:${employee.email}`} className="break-all hover:underline">
                {employee.email}
              </a>
            </Fact>
          )}
          {employee.manager && (
            <Fact icon={UserRound}>
              <span className="text-muted-foreground">{t('fields.manager')}</span>{' '}
              <Link
                to={`/employees/${employee.manager.id}`}
                className="font-medium hover:underline"
              >
                {employee.manager.firstName} {employee.manager.lastName}
              </Link>
            </Fact>
          )}
          {employee.teams.length > 0 && (
            <Fact icon={Users}>
              {formatList(
                employee.teams.map((team) => team.name),
                language,
              )}
            </Fact>
          )}
        </ul>
        {children}
      </div>
    </section>
  );
}

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}
