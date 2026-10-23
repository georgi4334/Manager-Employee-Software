import { cn } from '@/shared/lib/cn';

/** Initials on a token-coloured circle (photos arrive with file storage). Decorative: the name is next to it. */
export function EmployeeAvatar({
  firstName,
  lastName,
  className,
}: {
  firstName: string;
  lastName: string;
  className?: string;
}) {
  const initials = `${[...firstName][0] ?? ''}${[...lastName][0] ?? ''}`.toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground',
        className,
      )}
    >
      {initials}
    </span>
  );
}
