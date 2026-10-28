import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/shared/lib/cn';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-[color,background-color,filter,transform] duration-200 ease-[var(--ease-standard)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'btn-ring bg-primary text-primary-foreground [--btn-bg:var(--primary)] hover:brightness-110',
        secondary:
          'border border-border bg-surface text-foreground shadow-[inset_0_0_0_2px_var(--btn-bg),inset_0_0_0_3px_var(--accent),var(--shadow-card)] [--btn-bg:var(--surface)] hover:bg-surface-muted hover:[--btn-bg:var(--surface-muted)]',
        ghost: 'text-foreground hover:bg-surface-muted',
        danger:
          'btn-ring bg-danger text-danger-foreground [--btn-bg:var(--danger)] hover:brightness-110',
      },
      size: { default: '', icon: 'w-11 px-0' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}
