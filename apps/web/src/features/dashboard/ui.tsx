import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';

export type Tone = 'primary' | 'info' | 'success' | 'warning';

const TONES: Record<Tone, { card: string; tile: string; line: string }> = {
  primary: {
    card: 'border-primary/25 from-primary/10',
    tile: 'bg-primary text-primary-foreground',
    line: 'text-primary',
  },
  info: {
    card: 'border-info/25 from-info/10',
    tile: 'bg-info text-info-foreground',
    line: 'text-info',
  },
  success: {
    card: 'border-success/25 from-success/10',
    tile: 'bg-success text-success-foreground',
    line: 'text-success',
  },
  warning: {
    card: 'border-warning/25 from-warning/10',
    tile: 'bg-warning text-warning-foreground',
    line: 'text-warning',
  },
};

interface StatCardProps {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  value: ReactNode;
  note?: ReactNode;
  trend?: number[];
  /** Without a link the card is a plain figure. */
  to?: string;
}

/** A coloured figure card: icon tile, value, a short note and an optional trend line. */
export function StatCard({ title, icon: Icon, tone, value, note, trend, to }: StatCardProps) {
  const style = TONES[tone];
  const className = cn(
    'flex min-h-40 flex-col gap-3 rounded-xl glass bg-gradient-to-br to-transparent p-4',
    to && 'glass-hover transition-transform active:scale-[0.99]',
    style.card,
  );
  const content = (
    <>
      <div className="flex items-start gap-3">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', style.tile)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-2xl font-semibold leading-tight">{value}</p>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {trend && trend.length > 1 && (
        <Sparkline values={trend} className={cn('mt-auto h-8', style.line)} />
      )}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** A trend line; decoration only (the figure next to it carries the value). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1);
  const step = 100 / (values.length - 1);
  const points = values.map(
    (v, i) => `${(i * step).toFixed(2)},${(30 - (v / max) * 26).toFixed(2)}`,
  );
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      aria-hidden="true"
    >
      <path d={`M0,32 L${points.join(' L')} L100,32 Z`} fill="currentColor" opacity="0.12" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface WidgetCardProps {
  title: string;
  icon: LucideIcon;
  to?: string;
  linkText?: string;
  children: ReactNode;
}

/** A white card with a title, content and a "view all" link at the bottom. */
export function WidgetCard({ title, icon: Icon, to, linkText, children }: WidgetCardProps) {
  const { t } = useTranslation('dashboard');
  return (
    <section className="flex min-h-60 flex-col rounded-xl glass p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="flex-1">{children}</div>
      {to && (
        <Link
          to={to}
          className="mt-3 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
        >
          {linkText ?? t('viewAll')}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

/** Rows of a list card. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

export function Row({
  title,
  detail,
  aside,
}: {
  title: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      {aside && <div className="shrink-0 text-xs text-muted-foreground">{aside}</div>}
    </li>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent';
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'accent'
          ? 'bg-accent text-accent-foreground'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** Vertical bars with the value written above each bar. */
export function Bars({
  items,
}: {
  items: { key: string; label: string; value: number; text: string }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex h-40 items-end gap-2">
      {items.map((item) => (
        <li key={item.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[0.6875rem] text-muted-foreground">{item.text}</span>
          <span
            aria-hidden="true"
            className="w-full max-w-10 rounded-t-md bg-primary/80"
            style={{ height: `${Math.max((item.value / max) * 100, item.value > 0 ? 4 : 1)}%` }}
          />
          <span className="text-xs font-medium">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** A labelled horizontal meter; the percentage is written next to it. */
export function Meter({ label, percent, text }: { label: string; percent: number; text: string }) {
  return (
    <li className="space-y-1 py-1.5">
      <div className="flex justify-between gap-2 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground">{text}</span>
      </div>
      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-secondary">
        <span
          className={cn('block h-full rounded-full', percent > 100 ? 'bg-danger' : 'bg-primary')}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </span>
    </li>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
