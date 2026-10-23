import type { Employee } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/shared/lib/format';
import { Card, CardTitle } from '@/shared/ui/card';
import { EmployeeAvatar } from './EmployeeAvatar';

/** Name, directory data and (when the caller may see it) the full profile of one employee. */
export function EmployeeSummary({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation('employees');
  const language = i18n.resolvedLanguage ?? 'en';
  const profile = employee.profile;
  const none = t('notProvided');
  const date = (value: string | null | undefined) =>
    value
      ? formatDate(`${value}T00:00:00Z`, language, { dateStyle: 'long', timeZone: 'UTC' })
      : none;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <EmployeeAvatar
          firstName={employee.firstName}
          lastName={employee.lastName}
          className="size-14 text-lg"
        />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[employee.jobTitle, employee.status === 'inactive' ? t('badge.inactive') : null]
              .filter(Boolean)
              .join(' · ') || none}
          </p>
        </div>
      </div>

      <Card className="space-y-3">
        <CardTitle>{t('sections.directory')}</CardTitle>
        <Details
          rows={[
            [t('fields.email'), employee.email ?? none],
            [t('fields.jobTitle'), employee.jobTitle ?? none],
            [t('fields.location'), employee.location ?? none],
          ]}
        />
      </Card>

      {profile ? (
        <>
          <Card className="space-y-3">
            <CardTitle>{t('sections.employment')}</CardTitle>
            <Details
              rows={[
                [t('fields.employeeNo'), profile.employeeNo ?? none],
                [t('fields.employmentType'), t(`employmentType.${profile.employmentType}`)],
                [
                  t('fields.seniority'),
                  profile.seniority ? t(`seniority.${profile.seniority}`) : none,
                ],
                [t('fields.hireDate'), date(profile.hireDate)],
                ...(employee.status === 'inactive'
                  ? ([[t('fields.terminationDate'), date(profile.terminationDate)]] as const)
                  : []),
              ]}
            />
          </Card>
          <Card className="space-y-3">
            <CardTitle>{t('sections.personal')}</CardTitle>
            <Details
              rows={[
                [t('fields.birthDate'), date(profile.birthDate)],
                [t('fields.phone'), profile.phone ?? none],
                [t('fields.country'), profile.country ?? none],
              ]}
            />
          </Card>
          <Card className="space-y-3">
            <CardTitle>{t('sections.account')}</CardTitle>
            <Details
              rows={[
                [t('sections.account'), t(`accountStatus.${profile.accountStatus ?? 'none'}`)],
              ]}
            />
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('limitedView')}</p>
      )}
    </div>
  );
}

function Details({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="break-words text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
