import { useEffect, useState } from 'react';
import { Building2, Mail, MapPin, Plus, Search } from 'lucide-react';
import type { Employee } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { PAGE_SIZE, type ListParams } from './api';
import { EmployeeAvatar } from './EmployeeAvatar';
import { useEmployees } from './hooks';
import { useEmployeeErrors } from './use-employee-messages';

const SEARCH_DELAY_MS = 300;

export function EmployeesPage() {
  const { t } = useTranslation(['employees', 'common']);
  const errors = useEmployeeErrors();
  const canCreate = usePermission('employee.create');
  const canSeeInactive = usePermission('employee.deactivate');

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ListParams['status']>('active');
  const [page, setPage] = useState(1);

  // Search while typing, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useEmployees({ q, status, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canCreate && (
          <Button asChild>
            <Link to="/employees/new">
              <Plus className="size-4" aria-hidden="true" />
              {t('add')}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            className="pl-9"
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {canSeeInactive && (
          <Select
            className="sm:w-44"
            aria-label={t('statusLabel')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ListParams['status']);
              setPage(1);
            }}
          >
            {(['active', 'inactive', 'all'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </div>

      {query.isPending && (
        <SkeletonGroup
          label={t('common:loading')}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-48 rounded-xl" />
          ))}
        </SkeletonGroup>
      )}

      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('common:retry')}</Button>
        </Card>
      )}

      {data && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('total', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <Card>
              <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('list')}>
              {data.items.map((employee) => (
                <EmployeeCard key={employee.id} employee={employee} />
              ))}
            </ul>
          )}

          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label={t('pagination')}>
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">{t('page', { page, pages })}</span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/** A person in the directory: a small banner like the profile page, the avatar across it and the key facts. */
function EmployeeCard({ employee }: { employee: Employee }) {
  const { t } = useTranslation('employees');
  const name = `${employee.firstName} ${employee.lastName}`;
  return (
    <li>
      <article className="relative h-full overflow-hidden rounded-xl glass glass-hover">
        <div aria-hidden="true" className="h-14 border-b-2 border-brand bg-sidebar" />
        <div className="px-4 pb-4">
          <div className="-mt-8 flex items-end justify-between gap-2">
            <EmployeeAvatar
              firstName={employee.firstName}
              lastName={employee.lastName}
              className="size-16 text-lg ring-4 ring-surface"
            />
            <span className="flex flex-wrap justify-end gap-1.5">
              {employee.isSelf && <Badge>{t('badge.you')}</Badge>}
              {employee.status === 'inactive' && <Badge>{t('badge.inactive')}</Badge>}
            </span>
          </div>
          <h2 className="mt-2 break-words text-base font-semibold leading-snug">
            {/* The name links; the stretched link makes the whole card clickable. */}
            <Link
              to={`/employees/${employee.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {name}
            </Link>
          </h2>
          {employee.jobTitle && (
            <p className="break-words text-sm text-muted-foreground">{employee.jobTitle}</p>
          )}
          <ul className="mt-3 space-y-1.5 text-sm">
            {employee.location && <Fact icon={MapPin}>{employee.location}</Fact>}
            {employee.department && <Fact icon={Building2}>{employee.department.name}</Fact>}
            {employee.email && <Fact icon={Mail}>{employee.email}</Fact>}
          </ul>
        </div>
      </article>
    </li>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof Mail; children: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}
