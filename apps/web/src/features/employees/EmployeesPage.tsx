import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
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
    <div className="mx-auto max-w-4xl space-y-4">
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
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
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
            <ul className="space-y-2" aria-label={t('list')}>
              {data.items.map((employee) => (
                <li key={employee.id}>
                  <Link
                    to={`/employees/${employee.id}`}
                    className="flex min-h-14 items-center gap-3 rounded-xl glass p-3 glass-hover"
                  >
                    <EmployeeAvatar firstName={employee.firstName} lastName={employee.lastName} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">
                          {employee.firstName} {employee.lastName}
                        </span>
                        {employee.isSelf && <Badge>{t('badge.you')}</Badge>}
                        {employee.status === 'inactive' && <Badge>{t('badge.inactive')}</Badge>}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {[employee.jobTitle, employee.location].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="hidden truncate text-sm text-muted-foreground md:block">
                      {employee.email}
                    </span>
                  </Link>
                </li>
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

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}
