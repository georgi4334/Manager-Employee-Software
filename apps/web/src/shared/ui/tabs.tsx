import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface TabItem {
  name: string;
  label: string;
}

interface TabListProps {
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange: (name: string) => void;
  /** Gives each tab `<prefix>-tab-<name>` and `aria-controls="<prefix>-panel"`. */
  idPrefix?: string;
}

/** A segmented control: the highlight slides from tab to tab like the iOS one. */
export function TabList({ label, tabs, value, onChange, idPrefix }: TabListProps) {
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const active = element.querySelector<HTMLElement>('[aria-selected="true"]');
      if (active) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    // Language and window size change the widths.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value, tabs]);

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className="relative flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
    >
      {thumb && (
        <span
          aria-hidden="true"
          // Mounted already in place, so it only moves when the selection changes.
          className="motion-tab-thumb absolute inset-y-1 left-0 rounded-lg bg-primary"
          style={{ width: thumb.width, transform: `translate3d(${thumb.left}px,0,0)` }}
        />
      )}
      {tabs.map(({ name, label: text }) => (
        <button
          key={name}
          type="button"
          role="tab"
          id={idPrefix ? `${idPrefix}-tab-${name}` : undefined}
          aria-selected={value === name}
          aria-controls={idPrefix ? `${idPrefix}-panel` : undefined}
          onClick={() => onChange(name)}
          className={cn(
            'relative min-h-11 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-300',
            value === name
              ? 'text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

interface TabPanelProps {
  /** The selected tab; a change replays the entrance of the content. */
  value: string;
  idPrefix: string;
  children: ReactNode;
}

export function TabPanel({ value, idPrefix, children }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel`}
      aria-labelledby={value ? `${idPrefix}-tab-${value}` : undefined}
    >
      <div key={value} className="motion-enter">
        {children}
      </div>
    </div>
  );
}
