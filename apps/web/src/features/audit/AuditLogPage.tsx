import { utcToZoned, type AuditEntry } from '@intime/contracts';
import { ChevronDown, Cog, History, UserRound } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useMessages } from '@/features/auth/messages';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { SkeletonGroup, SkeletonLines } from '@/shared/ui/skeleton';
import { useAuditLog, type AuditFilters } from './api';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** The filters live in the address, so a filtered view can be shared or reloaded. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const read = (key: string, pattern?: RegExp) => {
    const value = params.get(key) ?? undefined;
    return value && (!pattern || pattern.test(value)) ? value : undefined;
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters: AuditFilters = {
    area: read('area'),
    from: read('from', DAY),
    to: read('to', DAY),
    entityId: read('entity', UUID),
    actorUserId: read('actor', UUID),
    page,
  };
  const set = (changes: Record<string, string | undefined>, keepPage = false) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!keepPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  return { filters, set };
}

/** The audit log (docs/adr/0041-audit-log-viewer.md): read-only, newest first, grouped by workspace day. */
export function AuditLogPage() {
  const { t } = useTranslation('audit');
  const messages = useMessages();
  const { filters, set } = useFilters();
  const validRange = !filters.from || !filters.to || filters.from <= filters.to;
  const query = useAuditLog(filters, validRange);
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(
    filters.area || filters.from || filters.to || filters.entityId || filters.actorUserId,
  );
  const actorName =
    filters.actorUserId &&
    data?.items.find((i) => i.actor.userId === filters.actorUserId)?.actor.name;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <section aria-label={t('filters')} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('area')}>
            {(field) => (
              <Select
                {...field}
                value={filters.area ?? ''}
                onChange={(e) => set({ area: e.target.value || undefined })}
              >
                <option value="">{t('allAreas')}</option>
                {(data?.areas ?? []).map((area) => (
                  <option key={area} value={area}>
                    {t(`areas.${area}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('from')}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.from ?? ''}
                onChange={(e) => set({ from: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label={t('to')} error={validRange ? undefined : t('invalidRange')}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.to ?? ''}
                invalid={!validRange}
                onChange={(e) => set({ to: e.target.value || undefined })}
              />
            )}
          </Field>
        </div>
        {(filters.entityId || filters.actorUserId || filtered) && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.entityId && (
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm">
                <History className="size-4" aria-hidden="true" />
                {t('recordFilter')}
              </span>
            )}
            {filters.actorUserId && (
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm">
                <UserRound className="size-4" aria-hidden="true" />
                {t('actorFilter', { name: actorName || t('unknownPerson') })}
              </span>
            )}
            {filtered && (
              <Button
                variant="ghost"
                onClick={() =>
                  set({
                    area: undefined,
                    from: undefined,
                    to: undefined,
                    entity: undefined,
                    actor: undefined,
                  })
                }
              >
                {t('clearFilters')}
              </Button>
            )}
          </div>
        )}
      </section>

      {query.isPending && validRange && (
        <SkeletonGroup label={t('loading')} className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <SkeletonLines lines={2} />
            </Card>
          ))}
        </SkeletonGroup>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data && validRange && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('total', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <Card>
              <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
            </Card>
          ) : (
            <Entries items={data.items} onFilter={(changes) => set(changes)} />
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label={t('pagination')}>
              <Button
                variant="secondary"
                disabled={filters.page <= 1}
                onClick={() => set({ page: String(filters.page - 1) }, true)}
              >
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('page', { page: filters.page, pages })}
              </span>
              <Button
                variant="secondary"
                disabled={filters.page >= pages}
                onClick={() => set({ page: String(filters.page + 1) }, true)}
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

function Entries({
  items,
  onFilter,
}: {
  items: AuditEntry[];
  onFilter: (changes: Record<string, string | undefined>) => void;
}) {
  const { t, i18n } = useTranslation('audit');
  const language = i18n.resolvedLanguage ?? 'en';
  const { data: user } = useCurrentUser();
  const zone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = useMemo(() => {
    const byDay = new Map<string, { entry: AuditEntry; time: string }[]>();
    for (const entry of items) {
      const local = utcToZoned(entry.at, zone);
      const list = byDay.get(local.date) ?? [];
      list.push({ entry, time: local.time });
      byDay.set(local.date, list);
    }
    return [...byDay.entries()];
  }, [items, zone]);

  return (
    <div className="space-y-5" aria-label={t('list')} role="region">
      {days.map(([date, entries]) => (
        <section key={date} aria-labelledby={`audit-day-${date}`} className="space-y-2">
          <h2 id={`audit-day-${date}`} className="text-sm font-semibold text-muted-foreground">
            {formatDay(date, language, { dateStyle: 'full' })}
          </h2>
          <ul className="space-y-2">
            {entries.map(({ entry, time }) => (
              <EntryRow key={entry.id} entry={entry} time={time} onFilter={onFilter} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  time,
  onFilter,
}: {
  entry: AuditEntry;
  time: string;
  onFilter: (changes: Record<string, string | undefined>) => void;
}) {
  const { t } = useTranslation('audit');
  const [group, verb] = entry.action.split('.');
  // Action texts are keyed by the catalog in contracts; the key is built from the stored action.
  const label = (t as unknown as (key: string, options: { defaultValue: string }) => string)(
    `actions.${group}.${verb}`,
    { defaultValue: t('unknownAction') },
  );
  const actor = entry.actor;
  const who = actor.userId === null ? t('system') : (actor.name ?? t('unknownPerson'));
  const subjectName = entry.subject ? (entry.subject.name ?? t('erasedPerson')) : null;
  const hasData = entry.before !== null || entry.after !== null;

  return (
    <li className="glass rounded-xl p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <time
          dateTime={entry.at}
          className="w-12 shrink-0 pt-0.5 text-sm font-medium tabular-nums text-muted-foreground"
        >
          {time}
        </time>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {actor.userId === null ? (
                <Cog className="size-3.5" aria-hidden="true" />
              ) : (
                <UserRound className="size-3.5" aria-hidden="true" />
              )}
              <span className="sr-only">{t('by')} </span>
              {actor.employeeId ? (
                <Link
                  to={`/employees/${actor.employeeId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {who}
                </Link>
              ) : (
                who
              )}
            </span>
            {subjectName && (
              <>
                {' · '}
                {entry.entityId && entry.subject?.name ? (
                  <Link
                    to={`/employees/${entry.entityId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {t('about', { name: subjectName })}
                  </Link>
                ) : (
                  <span>{t('about', { name: subjectName })}</span>
                )}
              </>
            )}
          </p>
        </div>
        <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {t(`areas.${entry.area}`)}
        </span>
      </div>
      <details className="group mt-2 sm:ml-15">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary">
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          {t('details')}
        </summary>
        <div className="space-y-3 pt-1 text-sm">
          {hasData ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {entry.before !== null && <Recorded title={t('before')} value={entry.before} />}
              {entry.after !== null && <Recorded title={t('after')} value={entry.after} />}
            </div>
          ) : (
            <p className="text-muted-foreground">{t('noDetails')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {entry.entityId && (
              <Button variant="secondary" onClick={() => onFilter({ entity: entry.entityId! })}>
                <History className="size-4" aria-hidden="true" />
                {t('historyOf')}
              </Button>
            )}
            {actor.userId && (
              <Button variant="secondary" onClick={() => onFilter({ actor: actor.userId! })}>
                <UserRound className="size-4" aria-hidden="true" />
                {t('byThisPerson')}
              </Button>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

/** What was stored with the entry (ids, field names, scopes): shown as it is, never interpreted. */
function Recorded({ title, value }: { title: string; value: unknown }) {
  const rows =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [['', value] as const];
  return (
    <div className="min-w-0 rounded-lg bg-surface-muted p-3">
      <h3 className="pb-1 text-xs font-semibold text-muted-foreground">{title}</h3>
      <dl className="space-y-1">
        {rows.map(([key, v]) => (
          <div key={key} className="flex min-w-0 flex-wrap gap-x-2">
            {key && <dt className="font-medium">{key}</dt>}
            <dd className="min-w-0 break-all font-mono text-xs leading-5">
              {typeof v === 'string' ? v : JSON.stringify(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
