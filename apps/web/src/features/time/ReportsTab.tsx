import {
  MAX_REPORT_DAYS,
  budgetUsage,
  daysBetween,
  formatDuration,
  type ReportGroup,
  type ReportRow,
} from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { useProjects } from '@/features/projects/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { useExportHours, useReport } from './hooks';
import { useTimeErrors } from './use-time-errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ReportsTab({ today }: { today: string }) {
  const { t } = useTranslation('time');
  const errors = useTimeErrors();
  const byProject = usePermission('time.report_project');
  const seesClients = usePermission('client.view');
  const canExport = usePermission('time.export');
  const groups: ReportGroup[] = [
    ...(byProject ? (['project'] as const) : []),
    'person',
    ...(byProject && seesClients ? (['client'] as const) : []),
  ];
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState<ReportGroup>(groups[0]!);
  const [projectId, setProjectId] = useState('');
  const projects = useProjects({ q: '', status: 'all', clientId: '', page: 1 });

  const problem =
    !DATE.test(from) || !DATE.test(to)
      ? 'invalidDate'
      : to < from
        ? 'end_before_start'
        : daysBetween(from, to) >= MAX_REPORT_DAYS
          ? 'too_long'
          : null;
  const params = { from, to, groupBy, projectId };
  const report = useReport(params, problem === null);
  const exporter = useExportHours();
  const data = report.data;

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label={t('reports.from')}>
          {(field) => (
            <Input {...field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <Field
          label={t('reports.to')}
          error={problem ? t(`reports.problem.${problem}`) : undefined}
        >
          {(field) => (
            <Input {...field} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </Field>
        <Field label={t('reports.groupBy')}>
          {(field) => (
            <Select
              {...field}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as ReportGroup)}
            >
              {groups.map((g) => (
                <option key={g} value={g}>
                  {t(`reports.groups.${g}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('reports.project')}>
          {(field) => (
            <Select {...field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('reports.allProjects')}</option>
              {(projects.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {canExport && (
          <div className="space-y-2 sm:col-span-2">
            <Button
              variant="secondary"
              disabled={problem !== null || exporter.isPending}
              onClick={() => exporter.mutate({ from, to, projectId })}
            >
              {exporter.isPending ? t('reports.exporting') : t('reports.export')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('reports.exportHint')}</p>
            {exporter.isError && <Alert tone="danger">{errors.apiError(exporter.error)}</Alert>}
            {exporter.isSuccess && (
              <Alert tone="success">{t('reports.exported', { count: exporter.data })}</Alert>
            )}
          </div>
        )}
      </Card>

      {problem === null && report.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {report.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(report.error)}</Alert>
          <Button onClick={() => void report.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {problem === null &&
        data &&
        (data.rows.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('reports.empty')}</p>
          </Card>
        ) : (
          <>
            <p className="text-sm" aria-live="polite">
              {t('reports.totals', {
                total: formatDuration(data.totalMinutes),
                billable: formatDuration(data.billableMinutes),
                approved: formatDuration(data.approvedMinutes),
              })}
            </p>
            <ul className="space-y-2" aria-label={t('tabs.reports')}>
              {data.rows.map((row) => (
                <Row key={row.id ?? 'none'} row={row} />
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}

function Row({ row }: { row: ReportRow }) {
  const { t } = useTranslation('time');
  const usage =
    row.loggedMinutes === null ? null : budgetUsage(row.loggedMinutes, row.budgetMinutes);
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{row.label || t('reports.noClient')}</p>
          {row.detail && <p className="text-sm text-muted-foreground">{row.detail}</p>}
        </div>
        <p className="text-lg font-semibold tabular-nums">
          {t('hours', { value: formatDuration(row.totalMinutes) })}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('reports.split', {
          billable: formatDuration(row.billableMinutes),
          approved: formatDuration(row.approvedMinutes),
        })}
      </p>
      {usage && row.budgetMinutes !== null && row.loggedMinutes !== null && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label={t('reports.budgetOf', { name: row.label })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, usage.percent)}
            aria-valuetext={`${usage.percent}%`}
            className="h-2 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={
                usage.level === 'over'
                  ? 'h-full bg-danger'
                  : usage.level === 'warning'
                    ? 'h-full bg-warning'
                    : 'h-full bg-primary'
              }
              style={{ width: `${Math.min(100, usage.percent)}%` }}
            />
          </div>
          <p className="text-sm">
            {t('reports.budget', {
              logged: formatDuration(row.loggedMinutes),
              budget: formatDuration(row.budgetMinutes),
              percent: usage.percent,
            })}{' '}
            <strong>{t(`reports.level.${usage.level}`)}</strong>
          </p>
        </div>
      )}
    </li>
  );
}
