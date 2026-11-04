import { utcToZoned, type AuditArea, type AuditEntry } from '@intime/contracts';
import {
  Award,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  Clock,
  Cog,
  GraduationCap,
  History,
  IdCard,
  ListFilter,
  ListChecks,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Target,
  Timer,
  UserCog,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useMessages } from '@/features/auth/messages';
import { cn } from '@/shared/lib/cn';
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

const AREA_ICON: Record<AuditArea, LucideIcon> = {
  workspace: Building2,
  users: UserCog,
  roles: ShieldCheck,
  people: Users,
  compensation: Wallet,
  privacy: Lock,
  leave: CalendarOff,
  attendance: Clock,
  time: Timer,
  projects: Briefcase,
  calendar: CalendarDays,
  goals: Target,
  reviews: Award,
  feedback: MessageSquareText,
  skills: GraduationCap,
  checklists: ListChecks,
};

type Tone = 'added' | 'removed' | 'changed';

/** What kind of change, from the verb of the action (decoration: the action is always written in words). */
export function actionTone(action: string): Tone {
  const verb = action.split('.')[1] ?? '';
  if (
    /(created|added|invited|started|enabled|reactivated|granted|requested|set$|opened)/.test(verb)
  )
    return 'added';
  if (/(deleted|removed|erased|disabled|deactivated|cancelled|rejected|offboarded)/.test(verb))
    return 'removed';
  return 'changed';
}

const TONE_DOT: Record<Tone, string> = {
  added: 'bg-success',
  removed: 'bg-danger',
  changed: 'bg-brand',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

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
    <div className="space-y-6" aria-label={t('list')} role="region">
      {days.map(([date, entries]) => (
        <section key={date} aria-labelledby={`audit-day-${date}`} className="space-y-3">
          <h2
            id={`audit-day-${date}`}
            className="sticky top-0 z-[1] text-sm font-semibold text-muted-foreground"
          >
            {formatDay(date, language, { dateStyle: 'full' })}
          </h2>
          {/* A timeline: a thin line down the day, one dot per entry. */}
          <ul className="relative space-y-3 before:absolute before:inset-y-2 before:left-[0.4375rem] before:w-px before:bg-border">
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
  const system = actor.userId === null;
  const who = system ? t('system') : (actor.name ?? t('unknownPerson'));
  const subjectName = entry.subject ? (entry.subject.name ?? t('erasedPerson')) : null;
  const hasData = entry.before !== null || entry.after !== null;
  const Icon = AREA_ICON[entry.area];

  return (
    <li className="relative pl-7">
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-5 size-[0.9375rem] rounded-full border-[3px] border-background',
          TONE_DOT[actionTone(entry.action)],
        )}
      />
      <article className="glass rounded-xl" aria-label={label}>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-primary"
            >
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold">{label}</span>
                <span className="text-xs text-muted-foreground">{t(`areas.${entry.area}`)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-[0.625rem] font-bold text-foreground"
                  >
                    {system ? (
                      <Cog className="size-3.5" />
                    ) : actor.name ? (
                      initials(actor.name)
                    ) : (
                      <UserRound className="size-3.5" />
                    )}
                  </span>
                  <span className="sr-only">{t('by')} </span>
                  {who}
                </span>
                {subjectName && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                    {t('about', { name: subjectName })}
                  </span>
                )}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <time dateTime={entry.at} className="text-sm font-medium tabular-nums">
                {time}
              </time>
              <span className="inline-flex min-h-6 items-center gap-0.5 text-xs font-medium text-primary">
                {t('details')}
                <ChevronDown
                  className="size-3.5 transition-transform duration-200 group-open:rotate-180"
                  aria-hidden="true"
                />
              </span>
            </span>
          </summary>
          <div className="space-y-3 border-t border-border/70 px-3 pb-3 pt-3 sm:px-4 sm:pb-4 sm:pl-[4.25rem]">
            {hasData ? (
              <Recorded before={entry.before} after={entry.after} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('noDetails')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {entry.entityId && (
                <Button variant="secondary" onClick={() => onFilter({ entity: entry.entityId! })}>
                  <History className="size-4" aria-hidden="true" />
                  {t('historyOf')}
                </Button>
              )}
              {actor.employeeId && (
                <Button asChild variant="ghost">
                  <Link to={`/employees/${actor.employeeId}`}>
                    <IdCard className="size-4" aria-hidden="true" />
                    {t('profileOf', { name: who })}
                  </Link>
                </Button>
              )}
              {entry.subject?.name && entry.entityId && (
                <Button asChild variant="ghost">
                  <Link to={`/employees/${entry.entityId}`}>
                    <IdCard className="size-4" aria-hidden="true" />
                    {t('profileOf', { name: entry.subject.name })}
                  </Link>
                </Button>
              )}
              {actor.userId && (
                <Button variant="ghost" onClick={() => onFilter({ actor: actor.userId! })}>
                  <ListFilter className="size-4" aria-hidden="true" />
                  {t('byThisPerson')}
                </Button>
              )}
            </div>
          </div>
        </details>
      </article>
    </li>
  );
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const show = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/**
 * What was stored with the entry (ids, field names, scopes): changed field names as chips, then one row per key with
 * the value before and after. Shown as stored, never interpreted.
 */
function Recorded({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation('audit');
  const b = asRecord(before);
  const a = asRecord(after);
  if ((before !== null && !b) || (after !== null && !a)) {
    // Not an object: show it as it is.
    return (
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {before !== null && <Value label={t('before')} value={show(before)} />}
        {after !== null && <Value label={t('after')} value={show(after)} />}
      </dl>
    );
  }
  const fields = [...new Set([...(asStrings(b?.fields) ?? []), ...(asStrings(a?.fields) ?? [])])];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter(
    (k) => !(k === 'fields' && asStrings((a ?? b)?.[k])),
  );

  return (
    <div className="space-y-3 text-sm">
      {fields.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('changedFields')}</h3>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('changedFields')}>
            {fields.map((field) => (
              <li
                key={field}
                className="rounded-md bg-brand/12 px-2 py-0.5 font-mono text-xs text-foreground"
              >
                {field}
              </li>
            ))}
          </ul>
        </div>
      )}
      {keys.length > 0 && (
        <dl className="divide-y divide-border/70 overflow-hidden rounded-lg bg-surface-muted">
          {keys.map((key) => {
            const had = b && key in b;
            const has = a && key in a;
            return (
              <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
                <dt className="font-medium">{key}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs leading-5">
                  {had && (
                    <>
                      <span className="sr-only">{t('before')}: </span>
                      <span
                        className={cn(
                          'break-all rounded px-1.5',
                          has ? 'text-muted-foreground line-through decoration-danger/60' : '',
                        )}
                      >
                        {show(b![key])}
                      </span>
                    </>
                  )}
                  {had && has && (
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  )}
                  {has && (
                    <>
                      <span className="sr-only">{t('after')}: </span>
                      <span className="break-all rounded bg-surface px-1.5">{show(a![key])}</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

function asStrings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-muted p-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs leading-5">{value}</dd>
    </div>
  );
}
