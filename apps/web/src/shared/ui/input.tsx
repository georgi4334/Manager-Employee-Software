import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '@/shared/lib/cn';
import { PickerInput } from './date-time-picker';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, invalid, ref, ...props }: InputProps) {
  // Dates and times use the calendar/clock picker; the value stays YYYY-MM-DD / HH:MM.
  if (props.type === 'date' || props.type === 'time') {
    const { type, ...rest } = props;
    return (
      <PickerInput
        kind={type === 'date' ? 'date' : 'time'}
        invalid={invalid}
        className={className}
        ref={ref}
        {...rest}
      />
    );
  }
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
