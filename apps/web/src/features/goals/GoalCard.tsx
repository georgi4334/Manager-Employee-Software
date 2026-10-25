import type { GoalSummary } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDay } from '@/shared/lib/format';
import { ProgressBar } from './ProgressBar';

export function GoalCard({ goal }: { goal: GoalSummary }) {
  const { t, i18n } = useTranslation('goals');
  const language = i18n.resolvedLanguage ?? 'en';
  const who =
    goal.scope === 'personal'
      ? `${goal.owner.firstName} ${goal.owner.lastName}`
      : goal.scope === 'team'
        ? (goal.team?.name ?? '')
        : t('scope.company');
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/goals/${goal.id}`} className="break-words font-medium text-primary underline">
            {goal.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {t(`scope.${goal.scope}`)}
            {' · '}
            {who}
            {' · '}
            {t(`status.${goal.status}`)}
            {goal.dueDate && ` · ${t('card.due', { date: formatDay(goal.dueDate, language) })}`}
            {goal.keyResultCount > 0 &&
              ` · ${t('card.keyResults', { count: goal.keyResultCount })}`}
          </p>
        </div>
        {goal.overdue && (
          <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">
            {t('card.overdue')}
          </span>
        )}
      </div>
      <ProgressBar pct={goal.progressPct} label={t('progressOf', { title: goal.title })} />
    </li>
  );
}
