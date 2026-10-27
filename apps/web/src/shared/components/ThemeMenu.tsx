import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useThemeStore, type ThemePreference } from '@/shared/stores/theme.store';

const OPTIONS: ThemePreference[] = ['light', 'dark', 'system'];
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Theme choice as a drop-down: icon and text on the button, icon and text for every option. */
export function ThemeMenu() {
  const { t } = useTranslation('common');
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const labelId = useId();
  const valueId = useId();
  const Current = ICONS[preference];

  // Close on a click or tap anywhere else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Focus the chosen option when the menu opens.
  useEffect(() => {
    if (open) items.current[OPTIONS.indexOf(preference)]?.focus();
  }, [open, preference]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((item) => item === document.activeElement);
    const focus = (next: number) => {
      event.preventDefault();
      items.current[(next + OPTIONS.length) % OPTIONS.length]?.focus();
    };
    if (event.key === 'Escape') {
      // Only the menu closes; an enclosing drawer stays open.
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(OPTIONS.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className="relative space-y-1.5">
      <p id={labelId} className="text-sm font-medium">
        {t('themeTitle')}
      </p>
      <button
        ref={trigger}
        aria-labelledby={`${labelId} ${valueId}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-muted"
      >
        <Current className="size-5 shrink-0" aria-hidden="true" />
        <span id={valueId} className="flex-1 text-left">
          {t(`theme.${preference}`)}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('themeTitle')}
          onKeyDown={onMenuKeyDown}
          className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-border bg-surface p-1 shadow-card"
        >
          {OPTIONS.map((option, index) => {
            const Icon = ICONS[option];
            const selected = option === preference;
            return (
              <button
                key={option}
                ref={(node) => {
                  items.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setPreference(option);
                  close();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm hover:bg-surface-muted',
                  selected && 'font-medium text-primary',
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-left">{t(`theme.${option}`)}</span>
                {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
