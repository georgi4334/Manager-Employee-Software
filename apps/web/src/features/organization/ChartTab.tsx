import { buildChartTree, type ChartNode } from '@intime/contracts';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmployeeAvatar } from '@/features/employees/EmployeeAvatar';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { useChart, useDepartments } from './hooks';
import { useOrgErrors } from './use-org-errors';

type Tree = ReturnType<typeof buildChartTree>;

/** Levels shown open at first; deeper levels start collapsed so a big company stays readable. */
const OPEN_LEVELS = 2;

type Expansion = { mode: 'default' | 'all' | 'none'; version: number };

/** People in a branch, the person included. */
const branchSize = (tree: Tree[number]): number =>
  1 + tree.reports.reduce((sum, child) => sum + branchSize(child), 0);

/**
 * The reporting lines as an org chart: on wider screens each manager sits above their direct reports with
 * connecting lines (the chart scrolls sideways inside its frame when it is wide); on a phone the same cards are
 * stacked and indented, so the page never scrolls sideways.
 */
export function ChartTab() {
  const { t } = useTranslation(['organization', 'common']);
  const errors = useOrgErrors();
  const chart = useChart();
  const departments = useDepartments();
  const tree = useMemo(() => buildChartTree(chart.data?.nodes ?? []), [chart.data]);
  const departmentName = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    [departments.data],
  );
  const [expansion, setExpansion] = useState<Expansion>({ mode: 'default', version: 0 });

  if (chart.isPending) {
    return (
      <SkeletonGroup label={t('loading')} className="flex flex-col items-center gap-6">
        <Skeleton className="h-32 w-60 rounded-xl" />
        <div className="flex gap-4">
          <Skeleton className="h-32 w-60 rounded-xl" />
          <Skeleton className="hidden h-32 w-60 rounded-xl md:block" />
        </div>
      </SkeletonGroup>
    );
  }
  if (chart.isError) {
    return (
      <Card className="space-y-3 text-center">
        <Alert tone="danger">{errors.apiError(chart.error)}</Alert>
        <Button onClick={() => void chart.refetch()}>{t('common:retry')}</Button>
      </Card>
    );
  }
  if (tree.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm text-muted-foreground">{t('chart.empty')}</p>
      </Card>
    );
  }
  const setAll = (mode: Expansion['mode']) =>
    setExpansion((current) => ({ mode, version: current.version + 1 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setAll('all')}>
          {t('chart.expandAll')}
        </Button>
        <Button variant="secondary" onClick={() => setAll('none')}>
          {t('chart.collapseAll')}
        </Button>
      </div>
      <div className="rounded-xl glass p-4 md:overflow-x-auto md:p-6">
        <ul
          key={expansion.version}
          aria-label={t('chart.label')}
          className="flex flex-col gap-6 md:mx-auto md:w-max md:flex-row md:items-start md:gap-10"
        >
          {tree.map((branch) => (
            <li
              key={branch.node.id}
              className="flex min-w-0 flex-col items-stretch md:items-center"
            >
              <Branch
                branch={branch}
                depth={0}
                expansion={expansion.mode}
                departmentName={departmentName}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface BranchProps {
  branch: Tree[number];
  depth: number;
  expansion: Expansion['mode'];
  departmentName: Map<string, string>;
}

function Branch({ branch, depth, expansion, departmentName }: BranchProps) {
  const { t } = useTranslation('organization');
  const { node, reports } = branch;
  const [open, setOpen] = useState(
    expansion === 'all' ? true : expansion === 'none' ? false : depth < OPEN_LEVELS,
  );
  const name = `${node.firstName} ${node.lastName}`;
  const listId = `chart-reports-${node.id}`;

  return (
    <>
      <PersonCard
        node={node}
        department={node.departmentId ? departmentName.get(node.departmentId) : undefined}
        reports={reports.length}
        branch={branchSize(branch)}
      />
      {reports.length > 0 && (
        <div className="flex items-center gap-2 md:flex-col md:gap-0">
          <span aria-hidden="true" className="hidden h-3 w-px bg-border md:block" />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={t(open ? 'chart.collapse' : 'chart.expand', { name })}
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="grid size-6 place-items-center rounded-full border border-border bg-surface text-foreground shadow-sm">
              {open ? (
                <Minus className="size-3.5" aria-hidden="true" />
              ) : (
                <Plus className="size-3.5" aria-hidden="true" />
              )}
            </span>
          </button>
          {!open && (
            <span className="text-xs text-muted-foreground">
              {t('chart.reports', { count: reports.length })}
            </span>
          )}
        </div>
      )}
      {open && reports.length > 0 && (
        <ul
          id={listId}
          aria-label={t('chart.reportsOf', { name })}
          className="ml-3 flex flex-col gap-4 border-l border-border pl-3 md:ml-0 md:flex-row md:gap-0 md:border-l-0 md:pl-0"
        >
          {reports.map((child, index) => (
            <li
              key={child.node.id}
              className={cn(
                'relative flex min-w-0 flex-col items-stretch md:items-center md:px-3 md:pt-8',
                // half of the bar over the children on each side; the outer halves are left out
                'md:before:absolute md:before:left-0 md:before:top-0 md:before:h-px md:before:w-1/2 md:before:bg-border',
                'md:after:absolute md:after:right-0 md:after:top-0 md:after:h-px md:after:w-1/2 md:after:bg-border',
                index === 0 && 'md:before:hidden',
                index === reports.length - 1 && 'md:after:hidden',
              )}
            >
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 hidden h-7 w-px -translate-x-1/2 bg-border md:block"
              />
              <ChevronDown
                aria-hidden="true"
                className="absolute left-1/2 top-4 hidden size-4 -translate-x-1/2 text-muted-foreground md:block"
              />
              <Branch
                branch={child}
                depth={depth + 1}
                expansion={expansion}
                departmentName={departmentName}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PersonCard({
  node,
  department,
  reports,
  branch,
}: {
  node: ChartNode;
  department: string | undefined;
  reports: number;
  branch: number;
}) {
  const { t } = useTranslation('organization');
  const [more, setMore] = useState(false);
  const name = `${node.firstName} ${node.lastName}`;

  return (
    <article
      aria-label={name}
      className={cn('w-full rounded-xl glass p-3.5 md:w-60', more && 'ring-2 ring-foreground')}
    >
      <div className="flex items-start justify-between gap-2">
        <EmployeeAvatar
          firstName={node.firstName}
          lastName={node.lastName}
          className="size-11 text-sm"
        />
        {department && (
          <span className="max-w-32 truncate rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {department}
          </span>
        )}
      </div>
      <p className="mt-2 break-words font-semibold leading-snug">{name}</p>
      {node.jobTitle && (
        <p className="break-words text-sm text-muted-foreground">{node.jobTitle}</p>
      )}
      {more && (
        <dl className="mt-3 space-y-1.5 border-t border-dashed border-border pt-3 text-sm">
          <Detail label={t('chart.directReports')} value={String(reports)} />
          <Detail label={t('chart.branch')} value={String(branch)} />
          <Detail label={t('chart.department')} value={department ?? t('noDepartment')} />
        </dl>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-border pt-3">
        <Button
          variant="ghost"
          className="whitespace-nowrap px-2"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          {more ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
          {more ? t('chart.less') : t('chart.more')} <span className="sr-only">{name}</span>
        </Button>
        <Button asChild variant="secondary" className="whitespace-nowrap px-3">
          <Link to={`/employees/${node.id}`}>
            {t('chart.viewProfile')} <span className="sr-only">{name}</span>
          </Link>
        </Button>
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
        {value}
      </dd>
    </div>
  );
}
