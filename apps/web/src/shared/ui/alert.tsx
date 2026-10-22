import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type Tone = 'danger' | 'success' | 'info';

const TONES: Record<Tone, string> = {
  danger: 'border-danger text-danger',
  success: 'border-success text-success',
  info: 'border-info text-info',
};

/** Errors are announced immediately (role=alert); success and info politely (role=status). */
export function Alert({
  tone = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border bg-surface px-3 py-2 text-sm', TONES[tone], className)}
      {...props}
    />
  );
}
