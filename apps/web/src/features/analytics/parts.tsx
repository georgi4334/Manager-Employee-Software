import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** One area of the figures as a dashboard-style card (docs/adr/0033-visual-style.md). */
export function Section({
  id,
  title,
  icon: Icon,
  className,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card md:p-5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** A row of small figure tiles inside a card. */
export function Stats({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold leading-tight">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface Bar {
  key: string;
  label: string;
  /** Used for the length of the bar. */
  value: number;
  /** What is written next to it (the bar alone never carries the information). */
  text: string;
}

/** A list of horizontal bars with the value in text; the bar is decoration. */
export function Bars({ title, bars }: { title: string; bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="space-y-2">
        {bars.map((b) => (
          <li key={b.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{b.label}</span>
              <span className="shrink-0 font-medium">{b.text}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${Math.round((b.value / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** Said in words where a breakdown is withheld because the group is too small. */
export function Suppressed({ title }: { title: string }) {
  const { t } = useTranslation('analytics');
  return <Note title={title} text={t('suppressed')} />;
}

export function NoData({ title }: { title: string }) {
  const { t } = useTranslation('analytics');
  return <Note title={title} text={t('noData')} />;
}
