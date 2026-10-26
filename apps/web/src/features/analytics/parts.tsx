import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
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
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="space-y-2">
        {bars.map((b) => (
          <li key={b.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{b.label}</span>
              <span className="shrink-0 font-medium">{b.text}</span>
            </div>
            <div className="h-2 rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${Math.round((b.value / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Said in words where a breakdown is withheld because the group is too small. */
export function Suppressed({ title }: { title: string }) {
  const { t } = useTranslation('analytics');
  return (
    <Card className="space-y-1 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{t('suppressed')}</p>
    </Card>
  );
}

export function NoData({ title }: { title: string }) {
  const { t } = useTranslation('analytics');
  return (
    <Card className="space-y-1 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{t('noData')}</p>
    </Card>
  );
}
