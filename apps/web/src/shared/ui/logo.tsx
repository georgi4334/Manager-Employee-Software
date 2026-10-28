import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/**
 * The InTime mark: a clock face open at the top whose dot is also the dot of the "i".
 * Same drawing as public/favicon.svg (which needs raw colours; this one uses tokens).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-9 shrink-0', className)}>
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <g className="fill-none stroke-sidebar" strokeWidth="2.75" strokeLinecap="round">
        <path d="M20.3 11.85A7.5 7.5 0 1 1 11.7 11.85" />
        <path d="M16 14.5V18h3.25" strokeLinejoin="round" />
      </g>
      <circle cx="16" cy="7.4" r="2.1" className="fill-sidebar" />
    </svg>
  );
}

/** Mark and name; the name is real text so it is translated and read out. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  const { t } = useTranslation('common');
  return (
    <span className={cn('flex items-center gap-2.5 font-bold tracking-tight', className)}>
      <LogoMark className={markClassName} />
      <span>{t('appName')}</span>
    </span>
  );
}
