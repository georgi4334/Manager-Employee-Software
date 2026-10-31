import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** Status tokens a bar may be filled with; each has a matching text colour for labels inside the fill. */
export type BarTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const BAR: Record<BarTone, { bar: string; fg: string }> = {
  primary: { bar: 'var(--primary)', fg: 'var(--primary-foreground)' },
  success: { bar: 'var(--success)', fg: 'var(--success-foreground)' },
  warning: { bar: 'var(--warning)', fg: 'var(--warning-foreground)' },
  danger: { bar: 'var(--danger)', fg: 'var(--danger-foreground)' },
  info: { bar: 'var(--info)', fg: 'var(--info-foreground)' },
  muted: { bar: 'var(--muted-foreground)', fg: 'var(--background)' },
};

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

/** Where the track of a target bar ends: a quarter past the target, or further when the value goes beyond. */
export const targetScale = (value: number, target: number): number =>
  Math.max(target * 1.25, value, 1);

/**
 * A slim track with a fixed target marker (ADR 0033). The fill stops at the marker, or runs past it striped, so
 * "over" never relies on colour alone. Decoration only: the caller always writes the numbers next to it.
 */
export function TargetBar({
  value,
  target,
  tone = 'primary',
  scale = targetScale(value, target),
  thin,
  className,
}: {
  value: number;
  /** 0 = no target (a day off): the fill is plain and there is no marker. */
  target: number;
  tone?: BarTone;
  /** The value at the right end of the track; pass the same scale to bars that are compared. */
  scale?: number;
  thin?: boolean;
  className?: string;
}) {
  const within = target > 0 ? Math.min(value, target) : value;
  const over = target > 0 ? Math.max(0, value - target) : 0;
  const style = { '--bar': BAR[tone].bar } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      data-testid="target-bar"
      className={cn('relative block', thin ? 'h-3' : 'h-4', className)}
      style={style}
    >
      <span
        className={cn(
          'absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-secondary',
          thin ? 'h-1.5' : 'h-2',
        )}
      />
      <span
        className={cn(
          'absolute left-0 top-1/2 -translate-y-1/2 bg-[var(--bar)]',
          thin ? 'h-1.5' : 'h-2',
          over > 0 ? 'rounded-l-full' : 'rounded-full',
        )}
        style={{ width: `${pct(within, scale)}%` }}
      />
      {over > 0 && (
        <span
          className={cn(
            'bar-overflow absolute top-1/2 -translate-y-1/2 rounded-r-full',
            thin ? 'h-1.5' : 'h-2',
          )}
          style={{ left: `${pct(target, scale)}%`, width: `${pct(over, scale)}%` }}
        />
      )}
      {target > 0 && (
        <span
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${pct(target, scale)}%` }}
        />
      )}
    </span>
  );
}

/**
 * The glass capsule (ADR 0033): a frosted tube with a liquid fill and the value inside it. For the one number a
 * card is about (goal progress, leave balance), not for long lists. `inside` is shown in the fill when it is wide
 * enough, otherwise right after it; it is decoration when the caller also writes the value.
 */
export function Capsule({
  percent,
  tone = 'primary',
  inside,
  after,
  size = 'md',
  className,
}: {
  percent: number;
  tone?: BarTone;
  inside?: ReactNode;
  /** Text in the empty part of the tube (e.g. what is left). */
  after?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, percent));
  const fits = width >= (size === 'lg' ? 22 : 28);
  const style = { '--bar': BAR[tone].bar, color: BAR[tone].fg } as CSSProperties;
  const height = size === 'lg' ? 'h-10' : size === 'md' ? 'h-8' : 'h-6';
  const text = size === 'lg' ? 'text-sm' : 'text-xs';
  return (
    <span className={cn('capsule relative flex items-center p-1', height, className)}>
      <span
        data-tone={tone}
        className={cn(
          'capsule-fill flex h-full shrink-0 items-center justify-end',
          width > 0 ? 'min-w-4 px-2.5' : 'invisible',
        )}
        style={{ ...style, width: `${width}%` }}
      >
        {fits && inside !== undefined && (
          <span className={cn('relative whitespace-nowrap font-semibold tabular-nums', text)}>
            {inside}
          </span>
        )}
      </span>
      {((!fits && inside !== undefined) || after !== undefined) && (
        <span
          className={cn(
            'flex min-w-0 items-center gap-2 whitespace-nowrap px-2.5 font-semibold tabular-nums text-foreground',
            text,
          )}
        >
          {!fits && inside}
          {after}
        </span>
      )}
    </span>
  );
}
