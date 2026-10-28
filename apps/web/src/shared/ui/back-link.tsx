import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';

/** The way back from a sub-page (detail, form, settings) to its list: always the same visible pill. */
export function BackLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-4 text-sm font-medium text-foreground shadow-card transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-standard)] hover:border-primary/40 hover:bg-accent active:scale-[0.97]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full bg-accent text-accent-foreground transition-transform duration-200 ease-[var(--ease-standard)] group-hover:-translate-x-0.5"
      >
        <ArrowLeft className="size-4" />
      </span>
      {children}
    </Link>
  );
}
