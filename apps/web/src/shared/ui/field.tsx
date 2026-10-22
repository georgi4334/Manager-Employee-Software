import { useId, type ReactElement, type ReactNode } from 'react';

interface FieldProps {
  label: string;
  /** Translated error message; shown below the control and announced to screen readers. */
  error?: string;
  hint?: string;
  /** Receives the ids that connect the label, hint and error to the control. */
  children: (props: { id: string; 'aria-describedby'?: string; invalid: boolean }) => ReactElement;
  action?: ReactNode;
}

export function Field({ label, error, hint, children, action }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {action}
      </div>
      {children({ id, 'aria-describedby': describedBy || undefined, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
