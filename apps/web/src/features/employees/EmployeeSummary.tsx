import type { Employee, EmployeeProfile } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/shared/lib/format';
import { Card, CardTitle } from '@/shared/ui/card';
import { ProfileHeader } from './ProfileHeader';

function useFormat() {
  const { t, i18n } = useTranslation('employees');
  const language = i18n.resolvedLanguage ?? 'en';
  const none = t('notProvided');
  const date = (value: string | null | undefined) =>
    value
      ? formatDate(`${value}T00:00:00Z`, language, { dateStyle: 'long', timeZone: 'UTC' })
      : none;
  return { t, none, date };
}

export function EmploymentSection({
  employee,
  profile,
}: {
  employee: Employee;
  profile: EmployeeProfile;
}) {
  const { t, none, date } = useFormat();
  return (
    <Card className="space-y-3">
      <CardTitle>{t('sections.employment')}</CardTitle>
      <Details
        rows={[
          [t('fields.employeeNo'), profile.employeeNo ?? none],
          [t('fields.employmentType'), t(`employmentType.${profile.employmentType}`)],
          [t('fields.seniority'), profile.seniority ? t(`seniority.${profile.seniority}`) : none],
          [t('fields.hireDate'), date(profile.hireDate)],
          ...(employee.status === 'inactive'
            ? ([[t('fields.terminationDate'), date(profile.terminationDate)]] as const)
            : []),
        ]}
      />
    </Card>
  );
}

export function PersonalSection({ profile }: { profile: EmployeeProfile }) {
  const { t, none, date } = useFormat();
  return (
    <>
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
          rows={[[t('sections.account'), t(`accountStatus.${profile.accountStatus ?? 'none'}`)]]}
        />
      </Card>
    </>
  );
}

export function LimitedViewNote() {
  const { t } = useTranslation('employees');
  return <p className="text-sm text-muted-foreground">{t('limitedView')}</p>;
}

/** The whole record on one page (My profile): header, then every section the caller may see. */
export function EmployeeSummary({ employee }: { employee: Employee }) {
  const profile = employee.profile;
  return (
    <div className="space-y-4">
      <ProfileHeader employee={employee} />
      {profile ? (
        <>
          <EmploymentSection employee={employee} profile={profile} />
          <PersonalSection profile={profile} />
        </>
      ) : (
        <LimitedViewNote />
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
