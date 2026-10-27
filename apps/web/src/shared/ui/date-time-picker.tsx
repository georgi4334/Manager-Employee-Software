import { addDays, todayIn, weekday } from '@intime/contracts';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { usePresence } from '@/shared/lib/motion';

type Kind = 'date' | 'time';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isValidTime = (text: string): boolean => TIME_PATTERN.test(text);

const complete = (kind: Kind, text: string) =>
  text === '' || (kind === 'date' ? isValidDate(text) : isValidTime(text));

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;

/** Sets the value the way typing would, so React and react-hook-form see a normal change event. */
function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface PickerInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  kind: Kind;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A text field that holds `YYYY-MM-DD` or `HH:MM` (typing works) plus a button that opens a
 * calendar or a clock. Change events fire only for an empty or complete value, like a native
 * date input, so partial typing never reaches forms or queries.
 */
export function PickerInput({
  kind,
  invalid,
  className,
  ref,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  disabled,
  ...props
}: PickerInputProps) {
  const { t } = useTranslation('common');
  const input = useRef<HTMLInputElement | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const presence = usePresence(open, 140);
  const [alignRight, setAlignRight] = useState(false);
  const [current, setCurrent] = useState('');
  const lastValid = useRef('');

  // Controlled use keeps its own draft so partial typing stays visible without reaching onChange.
  const controlled = value !== undefined;
  const [draft, setDraft] = useState(String(value ?? ''));
  const [seen, setSeen] = useState(value);
  if (controlled && value !== seen) {
    setSeen(value);
    setDraft(String(value));
  }

  const setRefs = (node: HTMLInputElement | null) => {
    input.current = node;
    if (typeof ref === 'function') return ref(node);
    if (ref) ref.current = node;
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (controlled) setDraft(text);
    if (!complete(kind, text)) return;
    lastValid.current = text;
    onChange?.(event);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const toggle = () => {
    if (open) return close(false);
    const text = input.current?.value ?? '';
    setCurrent(complete(kind, text) ? text : '');
    const rect = wrapper.current?.getBoundingClientRect();
    setAlignRight(Boolean(rect && rect.left + 320 > window.innerWidth));
    setOpen(true);
  };

  const pick = (text: string) => {
    if (!input.current) return;
    setNativeValue(input.current, text);
    lastValid.current = text;
    setCurrent(text);
  };

  const Icon = kind === 'date' ? CalendarDays : Clock;

  return (
    <div
      ref={wrapper}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <input
        {...props}
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder={
          props.placeholder ?? t(kind === 'date' ? 'datePlaceholder' : 'timePlaceholder')
        }
        aria-invalid={invalid || undefined}
        {...(controlled ? { value: draft } : { defaultValue })}
        onChange={handleChange}
        onFocus={(event) => {
          if (complete(kind, event.target.value)) lastValid.current = event.target.value;
          onFocus?.(event);
        }}
        onBlur={(event) => {
          // An unfinished entry never reached the form: show what the form still holds.
          if (!complete(kind, event.target.value)) {
            if (controlled) setDraft(lastValid.current);
            else event.target.value = lastValid.current;
          }
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && event.altKey && !disabled) toggle();
          props.onKeyDown?.(event);
        }}
        className={cn(
          // 16px font on mobile stops iOS from zooming into the field on focus.
          'min-h-11 w-full rounded-md border bg-surface pl-3 pr-12 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-60 md:text-sm',
          invalid ? 'border-danger' : 'border-border',
          className,
        )}
      />
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={toggle}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <Icon className="size-5" aria-hidden="true" />
        {/* text content, not aria-label: a field label like "Calendar" must not match the button */}
        <span className="sr-only">{t(kind === 'date' ? 'chooseDate' : 'chooseTime')}</span>
      </button>
      {presence.mounted && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t(kind === 'date' ? 'chooseDate' : 'chooseTime')}
          data-state={presence.state}
          style={{ '--pop-origin': alignRight ? 'top right' : 'top left' } as CSSProperties}
          className={cn(
            'motion-pop absolute top-full z-40 mt-1 w-[19.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-3 shadow-lg',
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          {kind === 'date' ? (
            <Calendar value={current} onPick={pick} onDone={() => close(true)} />
          ) : (
            <Clock24 value={current} onPick={pick} onDone={() => close(true)} />
          )}
        </div>
      )}
    </div>
  );
}

interface PanelProps {
  value: string;
  onPick: (text: string) => void;
  onDone: () => void;
}

const chip =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-surface-muted';

function Calendar({ value, onPick, onDone }: PanelProps) {
  const { t, i18n } = useTranslation('common');
  const language = i18n.language;
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const initial = isValidDate(value) ? value : today;
  const [year, setYear] = useState(Number(initial.slice(0, 4)));
  const [month, setMonth] = useState(Number(initial.slice(5, 7)));
  const [months, setMonths] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);

  useEffect(() => {
    if (focusDay) grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, year, month]);

  const shiftMonth = (delta: number) => {
    const index = year * 12 + (month - 1) + delta;
    setYear(Math.floor(index / 12));
    setMonth((index % 12) + 1);
  };

  const first = monthStart(year, month);
  // Monday first: pad with the days of the previous month so the grid starts on a Monday.
  const lead = (weekday(first) + 6) % 7;
  const gridStart = addDays(first, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = days.slice(35).every((d) => d.slice(5, 7) !== pad(month))
    ? days.slice(0, 35)
    : days;
  const label = (date: string, options: Intl.DateTimeFormatOptions) =>
    formatDay(date, language, options);

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const day = (event.target as HTMLElement).dataset.day;
    if (!day) return;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = addDays(day, delta);
    setYear(Number(next.slice(0, 4)));
    setMonth(Number(next.slice(5, 7)));
    setFocusDay(next);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          className={cn(chip, 'w-11 px-0')}
          aria-label={t(months ? 'previousYear' : 'previousMonth')}
          onClick={() => (months ? setYear(year - 1) : shiftMonth(-1))}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(chip, 'flex-1 capitalize')}
          aria-live="polite"
          aria-expanded={months}
          onClick={() => setMonths(!months)}
        >
          {months ? year : label(first, { month: 'long', year: 'numeric' })}
        </button>
        <button
          type="button"
          className={cn(chip, 'w-11 px-0')}
          aria-label={t(months ? 'nextYear' : 'nextMonth')}
          onClick={() => (months ? setYear(year + 1) : shiftMonth(1))}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {months ? (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === month}
              onClick={() => {
                setMonth(m);
                setMonths(false);
              }}
              className={cn(
                chip,
                'capitalize',
                m === month && 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {label(monthStart(year, m), { month: 'short' })}
            </button>
          ))}
        </div>
      ) : (
        <div ref={grid} onKeyDown={onGridKey}>
          <div
            className="grid grid-cols-7 text-center text-xs text-muted-foreground"
            aria-hidden="true"
          >
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="py-1">
                {label(addDays('2024-01-01', i), { weekday: 'short' })}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {weeks.map((day) => {
              const inMonth = day.slice(5, 7) === pad(month);
              const selected = day === value;
              return (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  aria-label={label(day, { dateStyle: 'full' })}
                  aria-pressed={selected}
                  aria-current={day === today ? 'date' : undefined}
                  // One tab stop: the selected day, else the first of the month.
                  tabIndex={selected || (!isValidDate(value) && day === first) ? 0 : -1}
                  onClick={() => {
                    onPick(day);
                    onDone();
                  }}
                  className={cn(
                    'mx-auto flex size-11 items-center justify-center rounded-md text-sm hover:bg-surface-muted',
                    !inMonth && 'text-muted-foreground',
                    day === today && !selected && 'border border-primary',
                    selected &&
                      'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
                  )}
                >
                  {Number(day.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          className={chip}
          onClick={() => {
            onPick('');
            onDone();
          }}
        >
          {t('clear')}
        </button>
        <button
          type="button"
          className={cn(chip, 'text-primary')}
          onClick={() => {
            onPick(today);
            onDone();
          }}
        >
          {t('today')}
        </button>
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => pad(i * 5));

function Clock24({ value, onPick, onDone }: PanelProps) {
  const { t } = useTranslation('common');
  const valid = isValidTime(value);
  const hour = valid ? value.slice(0, 2) : null;
  const minute = valid ? value.slice(3, 5) : null;
  const hours = useRef<HTMLDivElement>(null);
  const minutes = useRef<HTMLDivElement>(null);

  // Bring the chosen values into view when the clock opens.
  useEffect(() => {
    for (const list of [hours.current, minutes.current]) {
      const selected = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (list && selected) list.scrollTop = selected.offsetTop - list.offsetTop - 44;
    }
    // Only on open; later picks keep the scroll position the person chose.
  }, []);

  // A minute that is not a multiple of five (typed by hand) stays visible and selectable.
  const minuteOptions =
    minute && !MINUTE_STEPS.includes(minute) ? [...MINUTE_STEPS, minute].sort() : MINUTE_STEPS;

  const column = (
    ref: typeof hours,
    items: string[],
    selected: string | null,
    onSelect: (item: string) => void,
    title: string,
  ) => (
    <div className="flex-1">
      <p className="py-1 text-center text-xs text-muted-foreground">{title}</p>
      <div ref={ref} role="group" aria-label={title} className="relative max-h-56 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === selected}
            onClick={() => onSelect(item)}
            className={cn(
              'flex min-h-11 w-full items-center justify-center rounded-md text-sm hover:bg-surface-muted',
              item === selected &&
                'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
            )}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex gap-2">
        {column(hours, HOURS, hour, (h) => onPick(`${h}:${minute ?? '00'}`), t('hour'))}
        {column(minutes, minuteOptions, minute, (m) => onPick(`${hour ?? '09'}:${m}`), t('minute'))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          className={chip}
          onClick={() => {
            onPick('');
            onDone();
          }}
        >
          {t('clear')}
        </button>
        <button type="button" className={cn(chip, 'text-primary')} onClick={onDone}>
          {t('done')}
        </button>
      </div>
    </div>
  );
}
