import {
  DASHBOARD_WIDGETS,
  moveWidget,
  type DashboardWidget,
  type GrantedPermissions,
} from '@intime/contracts';
import { ArrowDown, ArrowUp, Plus, Settings2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useCurrentUser } from '@/features/auth/use-auth';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { useDashboardLayout, useResetLayout, useSaveLayout } from './hooks';
import { canUse, WIDGETS, type WidgetSize } from './widgets';

const SPAN: Record<WidgetSize, string> = {
  stat: '',
  card: '',
  wide: 'sm:col-span-2',
};

/** The workspace dashboard (docs/adr/0034-dashboard.md): an administrator arranges it for everybody. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const messages = useMessages();
  const { data: user } = useCurrentUser();
  const layout = useDashboardLayout();
  const save = useSaveLayout();
  const reset = useResetLayout();
  const [draft, setDraft] = useState<DashboardWidget[] | null>(null);
  const editing = draft !== null;
  const granted = user?.permissions as GrantedPermissions | undefined;

  const ids = draft ?? layout.data?.widgets ?? [];
  const shown = editing ? ids : ids.filter((id) => canUse(WIDGETS[id], granted));
  const missing = DASHBOARD_WIDGETS.filter((id) => !ids.includes(id));
  const title = (id: DashboardWidget) => t(`widgets.${id}.title`);
  const failed = save.error ?? reset.error;

  const finish = (run: Promise<unknown>) =>
    void run.then(
      () => setDraft(null),
      () => undefined,
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {layout.data?.canEdit && !editing && (
          <Button variant="secondary" onClick={() => setDraft([...ids])}>
            <Settings2 className="size-4" aria-hidden="true" />
            {t('customize')}
          </Button>
        )}
      </div>

      {editing && (
        <section
          aria-label={t('editing')}
          className="motion-enter sticky top-16 z-[5] flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-surface p-3 shadow-card"
        >
          <p className="max-w-prose text-sm text-muted-foreground">{t('editHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => finish(reset.mutateAsync())}
              disabled={reset.isPending}
            >
              {t('reset')}
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => finish(save.mutateAsync(draft))} disabled={save.isPending}>
              {t('save')}
            </Button>
          </div>
        </section>
      )}
      {failed && <Alert tone="danger">{messages.apiError(failed)}</Alert>}

      {layout.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {layout.isError && <Alert tone="danger">{messages.apiError(layout.error)}</Alert>}

      {layout.data && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('title')}>
        {shown.map((id, index) => {
          const widget = WIDGETS[id];
          const usable = canUse(widget, granted);
          const { Component } = widget;
          return (
            <li
              key={id}
              className={cn(
                'relative min-w-0',
                SPAN[widget.size],
                editing &&
                  'rounded-xl outline-2 outline-offset-2 outline-dashed outline-primary/40',
              )}
            >
              {editing && (
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveUp', { name: title(id) })}
                    disabled={index === 0}
                    onClick={() => setDraft(moveWidget(ids, index, -1))}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveDown', { name: title(id) })}
                    disabled={index === ids.length - 1}
                    onClick={() => setDraft(moveWidget(ids, index, 1))}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('remove', { name: title(id) })}
                    onClick={() => setDraft(ids.filter((x) => x !== id))}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
              {/* While arranging, the widgets are a preview: their links must not navigate away. */}
              <div className="flex-1" inert={editing}>
                {usable ? (
                  <Component />
                ) : (
                  <section className="flex h-full flex-col gap-1 rounded-xl border border-dashed border-border bg-surface p-4">
                    <h2 className="text-base font-semibold">{title(id)}</h2>
                    <p className="text-sm text-muted-foreground">{t('hiddenForYou')}</p>
                  </section>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <section aria-labelledby="dashboard-add" className="space-y-3">
          <h2 id="dashboard-add" className="text-base font-semibold">
            {t('addTitle')}
          </h2>
          {missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('allAdded')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {missing.map((id) => {
                const Icon = WIDGETS[id].icon;
                return (
                  <li key={id}>
                    <Button variant="secondary" onClick={() => setDraft([...ids, id])}>
                      <Plus className="size-4" aria-hidden="true" />
                      <Icon className="size-4" aria-hidden="true" />
                      <span className="sr-only">{t('add', { name: title(id) })}</span>
                      <span aria-hidden="true">{title(id)}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
