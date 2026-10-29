import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** A checkbox drawn as a pill: the colour dot of the layer, its name and a tick when it is on. */
export function LayerToggle({
  checked,
  onChange,
  label,
  dot,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        checked
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} />
      {dot && <span className={cn('size-2.5 shrink-0 rounded-full', dot)} aria-hidden="true" />}
      {label}
      <Check className="hidden size-4 shrink-0 peer-checked:block" aria-hidden="true" />
    </label>
  );
}
