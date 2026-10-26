import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, invalid, ref, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        // 16px font on mobile stops iOS from zooming into the field on focus.
        'min-h-24 w-full rounded-md border bg-surface px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-60 md:text-sm',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}
