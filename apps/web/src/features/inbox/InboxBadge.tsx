import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useInbox } from './use-inbox';

/**
 * The total waiting for the user next to the menu entry; nothing when zero. The number is decoration
 * (`part="number"`); the words for screen readers (`part="text"`) go after the entry's label.
 */
export function InboxBadge({
  part = 'both',
  className,
}: {
  part?: 'both' | 'number' | 'text';
  className?: string;
}) {
  const { t } = useTranslation('nav');
  const { items } = useInbox();
  const count = items.length;
  if (count === 0) return null;
  return (
    <>
      {part !== 'text' && (
        <span
          aria-hidden="true"
          className={cn(
            'min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-bold leading-5 tabular-nums text-sidebar',
            className,
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {part !== 'number' && (
        <span className="sr-only">
          {', '}
          {t('waiting', { count })}
        </span>
      )}
    </>
  );
}
