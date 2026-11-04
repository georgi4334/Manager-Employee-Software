import type { Employee } from '@intime/contracts';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useChecklists } from '@/features/checklists/hooks';
import { KindPill, StatusPill } from '@/features/checklists/ui';
import { formatDay } from '@/shared/lib/format';
import { Card, CardTitle } from '@/shared/ui/card';
import { Capsule } from '@/shared/ui/progress';
import { SkeletonGroup, SkeletonLines } from '@/shared/ui/skeleton';

/**
 * The onboarding and offboarding checklists about a person (docs/adr/0040-onboarding-checklists.md, follow-ups).
 * The API's `checklist.view` scope decides what comes back; nothing shows when there is none or the call is refused.
 */
export function ChecklistsCard({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation('checklists');
  const language = i18n.resolvedLanguage ?? 'en';
  const mayView = usePermission('checklist.view');
  const query = useChecklists(
    { kind: 'all', status: 'all', page: 1, employeeId: employee.id },
    mayView && !employee.erased,
  );
  if (!mayView || employee.erased || query.isError) return null;
  if (query.isPending) {
    return (
      <Card>
        <SkeletonGroup label={t('profileCard.loading')}>
          <SkeletonLines lines={2} />
        </SkeletonGroup>
      </Card>
    );
  }
  const items = query.data.items;
  if (items.length === 0) return null;
  const name = `${employee.firstName} ${employee.lastName}`;

  return (
    <Card className="space-y-3">
      <div>
        <CardTitle>{t('profileCard.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('profileCard.intro')}</p>
      </div>
      <ul className="space-y-2" aria-label={t('profileCard.label', { name })}>
        {items.map((c) => {
          const percent = c.total === 0 ? 0 : Math.round((c.done / c.total) * 100);
          return (
            <li key={c.id}>
              <Link
                to={`/checklists/${c.id}`}
                aria-label={t('profileCard.open', { name: c.name })}
                className="glass glass-hover flex items-center gap-3 rounded-xl p-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-medium">{c.name}</span>
                    <KindPill kind={c.kind} />
                    <StatusPill status={c.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`anchor.${c.kind}`, { date: formatDay(c.anchorDate, language) })}
                  </p>
                  <Capsule
                    size="sm"
                    percent={percent}
                    tone={c.status === 'done' ? 'success' : 'primary'}
                    inside={`${percent} %`}
                    after={t('progress', { done: c.done, total: c.total })}
                  />
                </div>
                <ChevronRight
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
