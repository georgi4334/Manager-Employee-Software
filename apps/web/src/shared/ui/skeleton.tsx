import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** A grey block standing in for content that is loading; decoration only. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('skeleton block', className)} />;
}

/** Wraps placeholder shapes so assistive technology hears one "Loading…" instead of nothing. */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={className}>
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}

const LINE_WIDTHS = ['w-full', 'w-4/5', 'w-3/5', 'w-11/12', 'w-2/3'];

export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', LINE_WIDTHS[i % LINE_WIDTHS.length])} />
      ))}
    </div>
  );
}

/** Same outline as the dashboard and analytics stat cards. */
export function SkeletonStatCard() {
  return (
    <div className="flex min-h-40 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <Skeleton className="mt-auto h-8 w-full" />
    </div>
  );
}

/** Same outline as a widget or section card: icon, heading, a few rows. */
export function SkeletonCard({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-60 flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card md:p-5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-4 w-32" />
      </div>
      <SkeletonLines lines={rows} />
    </div>
  );
}
