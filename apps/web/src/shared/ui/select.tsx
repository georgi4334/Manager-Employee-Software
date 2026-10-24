import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/** A native select (best on phones) styled like Input. */
export function Select({ className, invalid, ref, ...props }: SelectProps) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-11 w-full rounded-md border bg-surface px-3 text-base text-foreground disabled:opacity-60 md:text-sm',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}
