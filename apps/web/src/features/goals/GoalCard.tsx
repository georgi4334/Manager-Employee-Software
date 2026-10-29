import type { GoalScope, GoalStatus, GoalSummary } from '@intime/contracts';
import { Building2, CalendarDays, CornerLeftUp, ListChecks, User, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { initials } from '@/shared/ui/tiles';
import { ProgressBar, type ProgressTone } from './ProgressBar';

/** The same meaning per scope as in the calendar: personal orange, team blue, company green. */
export const SCOPE_STYLE: Record<GoalScope, { icon: LucideIcon; text: string; edge: string }> = {
  personal: { icon: User, text: 'text-primary', edge: 'border-l-primary' },
  team: { icon: Users, text: 'text-info', edge: 'border-l-info' },
  company: { icon: Building2, text: 'text-success', edge: 'border-l-success' },
};

const STATUS_PILL: Record<GoalStatus, string> = {
  draft: 'border-border text-muted-foreground',
  active: 'border-primary text-primary',
  done: 'border-success text-success',
  cancelled: 'border-border text-muted-foreground',
};

/** Done is green, overdue red, a cancelled goal grey; everything else is the brand colour. */
function toneOf(goal: GoalSummary): ProgressTone {
  if (goal.status === 'done') return 'success';
  if (goal.status === 'cancelled') return 'muted';
  return goal.overdue ? 'danger' : 'primary';
}

export function GoalCard({ goal }: { goal: GoalSummary }) {
  const { t, i18n } = useTranslation('goals');
  const language = i18n.resolvedLanguage ?? 'en';
  const style = SCOPE_STYLE[goal.scope];
  const ScopeIcon = style.icon;
  const who =
    goal.scope === 'personal'
      ? `${goal.owner.firstName} ${goal.owner.lastName}`
      : goal.scope === 'team'
        ? (goal.team?.name ?? '')
        : t('scope.company');

  return (
    <li
      className={cn(
        'relative space-y-3 rounded-xl border border-l-4 border-border bg-surface p-4 shadow-card transition-transform duration-[var(--dur-fast)] ease-[var(--ease-ios)] hover:bg-surface-muted motion-safe:hover:-translate-y-0.5',
        style.edge,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-xl bg-secondary',
            style.text,
          )}
        >
          <ScopeIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to={`/goals/${goal.id}`}
            className={cn(
              'block break-words text-base font-semibold leading-snug after:absolute after:inset-0 after:content-[""]',
              goal.status === 'cancelled' && 'text-muted-foreground line-through',
            )}
          >
            {goal.title}
          </Link>
          {goal.scope !== 'company' && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {goal.scope === 'personal' && (
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground"
                >
                  {initials(goal.owner.firstName, goal.owner.lastName)}
                </span>
              )}
              <span>{who}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium',
              STATUS_PILL[goal.status],
            )}
          >
            {t(`status.${goal.status}`)}
          </span>
          {goal.overdue && (
            <span className="rounded-full border border-danger px-2.5 py-0.5 text-xs font-medium text-danger">
              {t('card.overdue')}
            </span>
          )}
        </div>
      </div>

      <ProgressBar
        large
        pct={goal.progressPct}
        tone={toneOf(goal)}
        label={t('progressOf', { title: goal.title })}
      />

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className={cn('font-medium', style.text)}>{t(`scope.${goal.scope}`)}</span>
        {goal.dueDate && (
          <span className={cn('flex items-center gap-1.5', goal.overdue && 'text-danger')}>
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            {t('card.due', { date: formatDay(goal.dueDate, language) })}
          </span>
        )}
        {goal.keyResultCount > 0 && (
          <span className="flex items-center gap-1.5">
            <ListChecks className="size-4 shrink-0" aria-hidden="true" />
            {t('card.keyResults', { count: goal.keyResultCount })}
          </span>
        )}
        {goal.parent && (
          <span className="flex min-w-0 items-center gap-1.5">
            <CornerLeftUp className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {t('alignedTo')}: {goal.parent.title}
            </span>
          </span>
        )}
      </p>
    </li>
  );
}
