import { buildChartTree, type ChartNode } from '@intime/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { useChart, useDepartments } from './hooks';
import { useOrgErrors } from './use-org-errors';

type Tree = ReturnType<typeof buildChartTree>;

/** Levels shown open at first; deeper levels start collapsed so a big company stays readable on a phone. */
const OPEN_LEVELS = 2;

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

  if (chart.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
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
  return (
    <Card>
      <Level nodes={tree} depth={0} departmentName={departmentName} />
    </Card>
  );
}

function Level({
  nodes,
  depth,
  departmentName,
}: {
  nodes: Tree;
  depth: number;
  departmentName: Map<string, string>;
}) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'ml-3 space-y-1 border-l border-border pl-3'}>
      {nodes.map(({ node, reports }) => (
        <TreeNode
          key={node.id}
          node={node}
          reports={reports}
          depth={depth}
          departmentName={departmentName}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  reports,
  depth,
  departmentName,
}: {
  node: ChartNode;
  reports: Tree;
  depth: number;
  departmentName: Map<string, string>;
}) {
  const { t } = useTranslation('organization');
  const [open, setOpen] = useState(depth < OPEN_LEVELS);
  const name = `${node.firstName} ${node.lastName}`;
  const department = node.departmentId ? departmentName.get(node.departmentId) : undefined;

  return (
    <li>
      <div className="flex min-h-11 items-center gap-1">
        {reports.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-label={t(open ? 'chart.collapse' : 'chart.expand', { name })}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
          </Button>
        ) : (
          <span className="w-11 shrink-0" aria-hidden="true" />
        )}
        <Link to={`/employees/${node.id}`} className="min-w-0 rounded-md py-1 hover:underline">
          <span className="block font-medium">{name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {[node.jobTitle, department].filter(Boolean).join(' · ')}
          </span>
        </Link>
        {reports.length > 0 && !open && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {t('chart.reports', { count: reports.length })}
          </span>
        )}
      </div>
      {open && reports.length > 0 && (
        <Level nodes={reports} depth={depth + 1} departmentName={departmentName} />
      )}
    </li>
  );
}
