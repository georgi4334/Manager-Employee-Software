import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '@/shared/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, invalid, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        // 16px font on mobile stops iOS from zooming into the field on focus.
        'min-h-11 w-full rounded-md border bg-surface px-3 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-60 md:text-sm',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}
