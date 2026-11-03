import { zodResolver } from '@hookform/resolvers/zod';
import type { ChecklistQuery, MyChecklistItem } from '@intime/contracts';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useChart } from '@/features/organization/hooks';
import { useVisibleSections } from '@/app/sections';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Capsule } from '@/shared/ui/progress';
import { Select } from '@/shared/ui/select';
import { SkeletonCard, SkeletonGroup } from '@/shared/ui/skeleton';
import { TabContent, TabList } from '@/shared/ui/tabs';
import { initials } from '@/shared/ui/tiles';
import { startFormSchema, toStartRequest, type StartFormValues } from './forms';
import { useChecklists, useMyItems, useStartChecklist, useTemplates, useTickItem } from './hooks';
import { KindPill, StateChip, StatusPill, TickButton, itemState, useToday } from './ui';
import { useChecklistErrors } from './use-checklist-errors';

type Tab = 'mine' | 'people' | 'templates';

/** Onboarding and offboarding checklists (docs/adr/0040-onboarding-checklists.md). */
export function ChecklistsPage() {
  const { t } = useTranslation('checklists');
  const [params, setParams] = useSearchParams();
  const tabs: Tab[] = useVisibleSections('/checklists');
  const tab: Tab = tabs.find((x) => x === params.get('tab')) ?? tabs[0] ?? 'mine';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {tabs.length > 1 && (
        <TabList
          mode="toggle"
          label={t('tabs.label')}
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab}
          onChange={(name) => {
            const next = new URLSearchParams(params);
            if (name === tabs[0]) next.delete('tab');
            else next.set('tab', name);
            setParams(next, { replace: true });
          }}
        />
      )}
      <TabContent value={tab}>
        {tab === 'mine' && <MineTab />}
        {tab === 'people' && <PeopleTab />}
        {tab === 'templates' && <TemplatesTab />}
      </TabContent>
    </div>
  );
}

// ----- My to-dos ---------------------------------------------------------------------------------

function MineTab() {
  const { t, i18n } = useTranslation('checklists');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useChecklistErrors();
  const query = useMyItems();
  const tick = useTickItem();
  const today = useToday();
  const [said, setSaid] = useState('');

  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <Alert tone="danger">
        {errors.apiError(query.error)}{' '}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => void query.refetch()}
        >
          {t('retry')}
        </button>
      </Alert>
    );
  const items = query.data.items;
  return (
    <div className="space-y-3">
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {tick.isError && <Alert tone="danger">{errors.apiError(tick.error)}</Alert>}
      {items.length === 0 ? (
        <Empty text={t('mine.empty')} />
      ) : (
        <ul aria-label={t('tabs.mine')} className="divide-y divide-border rounded-xl glass">
          {items.map((item) => (
            <MyItemRow
              key={item.id}
              item={item}
              state={itemState(item, today)}
              language={language}
              busy={tick.isPending}
              onTick={() =>
                tick.mutate(
                  { checklistId: item.checklist.id, itemId: item.id, done: true },
                  { onSuccess: () => setSaid(t('ticked', { title: item.title })) },
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MyItemRow({
  item,
  state,
  language,
  busy,
  onTick,
}: {
  item: MyChecklistItem;
  state: ReturnType<typeof itemState>;
  language: string;
  busy: boolean;
  onTick: () => void;
}) {
  const { t } = useTranslation('checklists');
  const who = item.checklist.employee;
  return (
    <li className="flex items-start gap-2 p-3 sm:px-4">
      <TickButton title={item.title} done={false} disabled={busy} onToggle={onTick} />
      <div className="min-w-0 flex-1 py-1.5">
        <p className="break-words font-semibold leading-snug">{item.title}</p>
        <p className="break-words text-sm text-muted-foreground">
          {t('mine.of', {
            kind: t(`kind.${item.checklist.kind}`),
            name: `${who.firstName} ${who.lastName}`,
          })}{' '}
          · {t('due', { date: formatDay(item.dueDate, language) })}
          {!item.mine && <> · {t('mine.forHr')}</>}
        </p>
        <Link
          to={`/checklists/${item.checklist.id}`}
          className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {t('mine.open')}
        </Link>
      </div>
      <div className="py-2">
        <StateChip state={state} />
      </div>
    </li>
  );
}

// ----- People ------------------------------------------------------------------------------------

function PeopleTab() {
  const { t, i18n } = useTranslation('checklists');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useChecklistErrors();
  const canStart = usePermission('checklist.manage');
  const [kind, setKind] = useState<ChecklistQuery['kind']>('all');
  const [status, setStatus] = useState<ChecklistQuery['status']>('open');
  const [starting, setStarting] = useState(false);
  const query = useChecklists({ kind, status, page: 1 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1 sm:flex-none">
          <Field label={t('filters.kind')}>
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="all">{t('filters.all')}</option>
                <option value="onboarding">{t('kind.onboarding')}</option>
                <option value="offboarding">{t('kind.offboarding')}</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="min-w-40 flex-1 sm:flex-none">
          <Field label={t('filters.status')}>
            {(p) => (
              <Select
                {...p}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="open">{t('status.open')}</option>
                <option value="done">{t('status.done')}</option>
                <option value="cancelled">{t('status.cancelled')}</option>
                <option value="all">{t('filters.all')}</option>
              </Select>
            )}
          </Field>
        </div>
        {canStart && !starting && (
          <Button className="w-full sm:ml-auto sm:w-auto" onClick={() => setStarting(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('people.start')}
          </Button>
        )}
      </div>
      {starting && <StartForm onDone={() => setStarting(false)} />}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Alert tone="danger">{errors.apiError(query.error)}</Alert>
      ) : query.data.items.length === 0 ? (
        <Empty text={t('people.empty')} />
      ) : (
        <ul aria-label={t('tabs.people')} className="grid gap-3 sm:grid-cols-2">
          {query.data.items.map((c) => {
            const percent = c.total === 0 ? 0 : Math.round((c.done / c.total) * 100);
            return (
              <li key={c.id} className="relative space-y-3 rounded-xl glass glass-hover p-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                  >
                    {initials(c.employee.firstName, c.employee.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/checklists/${c.id}`}
                      className="break-words font-semibold after:absolute after:inset-0 after:content-['']"
                    >
                      {c.employee.firstName} {c.employee.lastName}
                    </Link>
                    <p className="break-words text-sm text-muted-foreground">
                      {c.name} ·{' '}
                      {t(`anchor.${c.kind}`, { date: formatDay(c.anchorDate, language) })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <KindPill kind={c.kind} />
                  <StatusPill status={c.status} />
                  {c.overdue > 0 && (
                    <span className="rounded-full border border-danger px-2 py-0.5 text-xs font-semibold text-danger">
                      {t('overdue', { count: c.overdue })}
                    </span>
                  )}
                </div>
                <Capsule
                  size="sm"
                  percent={percent}
                  tone={c.status === 'done' ? 'success' : 'primary'}
                  inside={`${percent} %`}
                  after={t('progress', { done: c.done, total: c.total })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StartForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('checklists');
  const { t: tv } = useTranslation('errors');
  const errors = useChecklistErrors();
  const chart = useChart();
  const templates = useTemplates();
  const start = useStartChecklist();
  const form = useForm<StartFormValues>({
    resolver: zodResolver(startFormSchema),
    defaultValues: { employeeId: '', templateId: '', anchorDate: '' },
  });
  const err = (key?: string) =>
    key ? tv(`validation.${key}` as 'validation.required') : undefined;
  const people = [...(chart.data?.nodes ?? [])].sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
  );
  const list = templates.data?.items ?? [];

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold">{t('people.start')}</h2>
      {templates.isSuccess && list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('people.noTemplates')}</p>
      ) : (
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={form.handleSubmit((values) =>
            start.mutate(toStartRequest(values), { onSuccess: onDone }),
          )}
        >
          <Field label={t('people.person')} error={err(form.formState.errors.employeeId?.message)}>
            {(p) => (
              <Select {...p} {...form.register('employeeId')}>
                <option value="">{t('people.choose')}</option>
                {people.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.firstName} {n.lastName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('people.template')}
            error={err(form.formState.errors.templateId?.message)}
          >
            {(p) => (
              <Select {...p} {...form.register('templateId')}>
                <option value="">{t('people.choose')}</option>
                {list.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({t(`kind.${tpl.kind}`)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('people.anchorDate')}
            hint={t('people.anchorHint')}
            error={err(form.formState.errors.anchorDate?.message)}
          >
            {(p) => <Input {...p} type="date" {...form.register('anchorDate')} />}
          </Field>
          {start.isError && (
            <div className="sm:col-span-3">
              <Alert tone="danger">{errors.apiError(start.error)}</Alert>
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" disabled={start.isPending}>
              {t('people.submit')}
            </Button>
            <Button type="button" variant="secondary" onClick={onDone}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ----- Templates ---------------------------------------------------------------------------------

function TemplatesTab() {
  const { t } = useTranslation('checklists');
  const errors = useChecklistErrors();
  const query = useTemplates();
  return (
    <div className="space-y-4">
      <Button asChild>
        <Link to="/checklists/templates/new">
          <Plus className="size-4" aria-hidden="true" />
          {t('templates.new')}
        </Link>
      </Button>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Alert tone="danger">{errors.apiError(query.error)}</Alert>
      ) : query.data.items.length === 0 ? (
        <Empty text={t('templates.empty')} />
      ) : (
        <ul aria-label={t('tabs.templates')} className="grid gap-3 sm:grid-cols-2">
          {query.data.items.map((tpl) => (
            <li key={tpl.id} className="relative space-y-2 rounded-xl glass glass-hover p-4">
              <Link
                to={`/checklists/templates/${tpl.id}`}
                className="block break-words font-semibold after:absolute after:inset-0 after:content-['']"
              >
                {tpl.name}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <KindPill kind={tpl.kind} />
                {tpl.isDefault && (
                  <span className="rounded-full border border-primary px-2.5 py-0.5 text-xs font-medium text-primary">
                    {t('templates.default')}
                  </span>
                )}
                <span>{t('templates.steps', { count: tpl.items.length })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----- shared ------------------------------------------------------------------------------------

function Loading() {
  const { t } = useTranslation('checklists');
  return (
    <SkeletonGroup label={t('loading')} className="grid gap-3 sm:grid-cols-2">
      <SkeletonCard rows={3} />
      <SkeletonCard rows={3} />
    </SkeletonGroup>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <ClipboardList className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{text}</p>
    </Card>
  );
}
