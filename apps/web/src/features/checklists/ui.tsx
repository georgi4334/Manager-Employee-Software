import {
  checklistItemState,
  todayIn,
  type ChecklistItemState,
  type ChecklistKind,
  type ChecklistStatus,
} from '@intime/contracts';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '@/features/auth/use-auth';
import { cn } from '@/shared/lib/cn';

/** "Today" in the user's time zone, for due states. */
export function useToday(): string {
  const { data: user } = useCurrentUser();
  return todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export const itemState = (item: { dueDate: string; done: boolean }, today: string) =>
  checklistItemState(item, today);

const KIND_STYLE: Record<ChecklistKind, string> = {
  onboarding: 'border-success text-success',
  offboarding: 'border-info text-info',
};

export function KindPill({ kind }: { kind: ChecklistKind }) {
  const { t } = useTranslation('checklists');
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        KIND_STYLE[kind],
      )}
    >
      {t(`kind.${kind}`)}
    </span>
  );
}

export function StatusPill({ status }: { status: ChecklistStatus }) {
  const { t } = useTranslation('checklists');
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        status === 'done'
          ? 'border-success text-success'
          : status === 'cancelled'
            ? 'border-border text-muted-foreground'
            : 'border-primary text-primary',
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

const STATE_STYLE: Record<ChecklistItemState, string> = {
  done: 'border-success text-success',
  overdue: 'border-danger text-danger',
  due_soon: 'border-warning text-warning',
  open: 'border-border text-muted-foreground',
};

/** The due state of a step in words (colour is decoration). */
export function StateChip({ state }: { state: ChecklistItemState }) {
  const { t } = useTranslation('checklists');
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
        STATE_STYLE[state],
      )}
    >
      {t(`state.${state}`)}
    </span>
  );
}

/** A 44px round tick button with the step's name in its label. */
export function TickButton({
  title,
  done,
  disabled,
  onToggle,
}: {
  title: string;
  done: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('checklists');
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t('untick', { title }) : t('tick', { title })}
      disabled={disabled}
      onClick={onToggle}
      className="grid size-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-6 place-items-center rounded-full border-2 transition-colors',
          done ? 'border-success bg-success text-success-foreground' : 'border-border bg-surface',
        )}
      >
        {done && <Check className="size-4" />}
      </span>
    </button>
  );
}
