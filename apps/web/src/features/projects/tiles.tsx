import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export const initials = (first: string, last = '') =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();

/** The soft rounded square at the top of a card: an icon or initials, decoration only. */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small tag, like the category chips of the design: quiet background, one short word. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}
