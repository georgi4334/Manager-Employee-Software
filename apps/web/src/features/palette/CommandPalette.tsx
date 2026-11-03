import {
  Briefcase,
  CornerDownLeft,
  ListChecks,
  Search,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { usePresence } from '@/shared/lib/motion';
import { useStaticEntries } from './entries';
import { rank } from './match';
import { useDebouncedQuery, useRemoteSearch } from './search';

type GroupId = 'actions' | 'pages' | 'people' | 'projects' | 'tasks';

interface Option {
  id: string;
  group: GroupId;
  label: string;
  /** Second line: what this is or where it belongs. */
  detail?: string;
  to: string;
  icon: LucideIcon;
}

/** Pages and actions shown at once; the rest comes up by typing. */
const LOCAL_LIMIT = 8;
const GROUP_ORDER: GroupId[] = ['actions', 'pages', 'people', 'projects', 'tasks'];

const onMac = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const isShortcut = (event: globalThis.KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  // The physical key, so Ctrl+K also works on Cyrillic and other non-Latin layouts.
  (event.code === 'KeyK' || event.key.toLowerCase() === 'k');

/**
 * The header search (docs/adr/0039-command-palette.md): a button, Ctrl+K / ⌘K, and the dialog with pages, actions,
 * people, projects and tasks. Choosing an entry only navigates.
 */
export function CommandPalette() {
  const { t } = useTranslation('palette');
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:mr-2 md:w-60 md:justify-start md:border lg:w-96 md:border-border md:bg-surface md:px-3.5 md:text-sm"
      >
        <Search className="size-5 md:size-4" aria-hidden="true" />
        <span className="sr-only md:not-sr-only">{t('open')}</span>
        <kbd
          aria-hidden="true"
          className="ml-auto hidden rounded border border-border px-1.5 font-sans text-xs md:inline"
        >
          {onMac() ? '⌘ K' : t('shortcut')}
        </kbd>
      </button>
      <PaletteDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PaletteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presence = usePresence(open);
  if (!presence.mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-6 md:pt-[12vh]">
      <div
        aria-hidden="true"
        data-state={presence.state}
        className="motion-fade absolute inset-0 bg-foreground/40"
        onClick={onClose}
      />
      {open && <Panel state={presence.state} onClose={onClose} />}
    </div>,
    document.body,
  );
}

function Panel({ state, onClose }: { state: string; onClose: () => void }) {
  const { t } = useTranslation('palette');
  const navigate = useNavigate();
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebouncedQuery(text);
  const remote = useRemoteSearch(q);
  const entries = useStaticEntries();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    return () => {
      document.body.style.overflow = scroll;
      opener?.focus?.();
    };
  }, []);

  const options = useMemo<Option[]>(() => {
    const local = rank(text, entries, (e) => e.label);
    const actions = local
      .filter((e) => e.kind === 'action')
      .slice(0, text.trim() ? LOCAL_LIMIT : 4)
      .map((e): Option => ({ ...e, group: 'actions' }));
    const pages = local
      .filter((e) => e.kind !== 'action')
      .slice(0, LOCAL_LIMIT)
      .map((e): Option => ({ ...e, group: 'pages' }));
    // Remote results belong to the query they were asked for; while typing on they stay until the next answer.
    const fresh = q !== '' && text.trim() !== '';
    const people = fresh
      ? remote.people.map((p): Option => ({
          id: `person:${p.id}`,
          group: 'people',
          label: `${p.firstName} ${p.lastName}`,
          detail: [p.jobTitle, p.department?.name].filter(Boolean).join(' · ') || undefined,
          to: `/employees/${p.id}`,
          icon: UserRound,
        }))
      : [];
    const projects = fresh
      ? remote.projects.map((p): Option => ({
          id: `project:${p.id}`,
          group: 'projects',
          label: p.name,
          detail: p.client ? `${p.code} · ${p.client.name}` : p.code,
          to: `/projects/${p.id}`,
          icon: Briefcase,
        }))
      : [];
    const tasks = fresh
      ? remote.tasks.map((task): Option => ({
          id: `task:${task.id}`,
          group: 'tasks',
          label: task.title,
          detail: `${task.key} · ${task.project.name}`,
          to: `/tasks?${new URLSearchParams({ project: task.project.id, q: task.key })}`,
          icon: ListChecks,
        }))
      : [];
    const byGroup: Record<GroupId, Option[]> = { actions, pages, people, projects, tasks };
    // With a query, places come before actions; on an empty palette, actions are the quick start.
    const order: GroupId[] = text.trim()
      ? ['pages', 'actions', 'people', 'projects', 'tasks']
      : GROUP_ORDER;
    return order.flatMap((group) => byGroup[group]);
  }, [text, entries, q, remote.people, remote.projects, remote.tasks]);

  const current = Math.min(active, Math.max(0, options.length - 1));
  const optionId = (index: number) => `${ids}-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  const choose = (option: Option | undefined) => {
    if (!option) return;
    onClose();
    void navigate(option.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(current >= last ? 0 : current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current <= 0 ? last : current - 1);
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      setActive(last);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[current]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      // The input is the only stop; options are reached with the arrows.
      event.preventDefault();
    }
  };

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.group === group),
  }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.items[0]!.index - b.items[0]!.index);

  const listId = `${ids}-list`;
  const waiting = text.trim().length >= 2 && (remote.searching || q !== text.trim());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      data-state={state}
      className="motion-pop menu-panel relative flex max-h-[80dvh] w-full max-w-xl flex-col p-0"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
          aria-label={t('label')}
          placeholder={t('placeholder')}
          maxLength={100}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <kbd
          aria-hidden="true"
          className="hidden rounded border border-border px-1.5 text-xs text-muted-foreground md:inline"
        >
          Esc
        </kbd>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {waiting ? t('searching') : t('results', { count: options.length })}
      </p>

      <div id={listId} role="listbox" aria-label={t('label')} className="overflow-y-auto p-2">
        {groups.map(({ group, items }) => (
          <div key={group} role="group" aria-labelledby={`${ids}-${group}`} className="pb-1">
            <div
              id={`${ids}-${group}`}
              role="presentation"
              className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground"
            >
              {t(`groups.${group}`)}
            </div>
            {items.map(({ option, index }) => {
              const Icon = option.icon;
              const selected = index === current;
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => active !== index && setActive(index)}
                  onClick={() => choose(option)}
                  className="menu-item flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
                  data-active={selected ? 'true' : undefined}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.detail && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    )}
                  </span>
                  <span className="sr-only">{t(`kinds.${group}`)}</span>
                  {selected && (
                    <CornerDownLeft
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {options.length === 0 && !waiting && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        )}
        {waiting && <p className="px-3 py-2 text-sm text-muted-foreground">{t('searching')}</p>}
        {remote.failed && !waiting && (
          <p className="px-3 py-2 text-sm text-danger">{t('failed')}</p>
        )}
      </div>
    </div>
  );
}
