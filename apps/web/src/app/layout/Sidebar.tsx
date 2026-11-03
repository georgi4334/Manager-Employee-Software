import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useId, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { useSidebarStore } from '@/shared/stores/sidebar.store';
import { Logo, LogoMark } from '@/shared/ui/logo';
import { GROUP_LABEL, groupNavItems, type NavItem } from '../nav';
import { InboxBadge } from '@/features/inbox/InboxBadge';
import { useSectionCounts } from '../section-counts';
import { PAGE_SECTIONS, sectionHref, useVisibleSections, type SectionPage } from '../sections';
import { useNavItems } from '../useNavItems';

const entryClass =
  (collapsed: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex min-h-11 items-center gap-3 rounded-xl text-sm font-medium transition-[background-color,color,transform] duration-300 ease-[var(--ease-standard)] active:scale-[0.98]',
      collapsed ? 'justify-center px-0' : 'px-3',
      isActive
        ? 'nav-active text-sidebar-foreground'
        : 'text-sidebar-muted hover:bg-sidebar-border/60 hover:text-sidebar-foreground',
    );

/**
 * The desktop menu (docs/adr/0037-navigation-groups.md): entries under group headings, Administration set apart at the
 * bottom, and the sections of the open page as indented links under its entry. It can be collapsed to an icon rail
 * (docs/adr/0042-collapsible-sidebar.md): labels stay as accessible names and show as a tooltip on hover and focus.
 */
export function Sidebar() {
  const { t } = useTranslation(['common', 'nav']);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const navId = useId();
  const groups = groupNavItems(useNavItems());
  const main = groups.filter((g) => g.group !== 'admin');
  const admin = groups.find((g) => g.group === 'admin');
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = t(collapsed ? 'common:sidebar.expand' : 'common:sidebar.collapse');
  return (
    <aside
      data-collapsed={collapsed ? 'true' : undefined}
      className="hidden bg-sidebar text-sidebar-foreground scrollbar-subtle md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto md:overflow-x-hidden"
    >
      <div
        className={cn(
          'flex pb-6 pt-9',
          collapsed ? 'flex-col items-center gap-3 px-3' : 'items-center gap-2 pl-6 pr-3',
        )}
      >
        {collapsed ? (
          <span className="flex">
            <LogoMark />
            <span className="sr-only">{t('common:appName')}</span>
          </span>
        ) : (
          <Logo className="flex-1 gap-3 text-xl" />
        )}
        <button
          type="button"
          onClick={toggle}
          aria-controls={navId}
          title={toggleLabel}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground"
        >
          <ToggleIcon className="size-5" aria-hidden="true" />
          <span className="sr-only">{toggleLabel}</span>
        </button>
      </div>
      <nav
        id={navId}
        aria-label={t('common:mainNavigation')}
        className="flex flex-1 flex-col gap-1 px-3 pb-8"
      >
        {main.map(({ group, items }) =>
          group === 'top' ? (
            <ul key={group} className="flex flex-col gap-1">
              {items.map((item) => (
                <Entry key={item.path} item={item} collapsed={collapsed} />
              ))}
            </ul>
          ) : (
            <Group
              key={group}
              label={t(`nav:${GROUP_LABEL[group]}`)}
              items={items}
              collapsed={collapsed}
            />
          ),
        )}
        {admin && (
          <div className="mt-auto border-t border-sidebar-border pt-2">
            <Group
              label={t(`nav:${GROUP_LABEL.admin}`)}
              items={admin.items}
              collapsed={collapsed}
            />
          </div>
        )}
      </nav>
    </aside>
  );
}

function Group({
  label,
  items,
  collapsed,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
}) {
  const id = useId();
  return (
    // On the rail a thin line stands for the heading, which stays as the list's name.
    <div className={collapsed ? 'mt-2 border-t border-sidebar-border/70 pt-2' : 'mt-3'}>
      <p
        id={id}
        className={
          collapsed
            ? 'sr-only'
            : 'px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-sidebar-muted'
        }
      >
        {label}
      </p>
      <ul aria-labelledby={id} className="flex flex-col gap-1">
        {items.map((item) => (
          <Entry key={item.path} item={item} collapsed={collapsed} />
        ))}
      </ul>
    </div>
  );
}

function Entry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation('nav');
  const { pathname } = useLocation();
  const tip = useRailTip();
  const { path, labelKey, icon: Icon } = item;
  const open =
    path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
  const label = t(labelKey);
  if (collapsed) {
    return (
      <li>
        <NavLink to={path} end={path === '/'} className={entryClass(true)} {...tip.handlers}>
          <Icon className="size-5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
          {path === '/inbox' && (
            <>
              <InboxBadge
                part="number"
                className="absolute right-0.5 top-0.5 min-w-4 px-1 text-[0.625rem] leading-4"
              />
              <InboxBadge part="text" />
            </>
          )}
        </NavLink>
        {tip.render(label)}
      </li>
    );
  }
  return (
    <li>
      <NavLink to={path} end={path === '/'} className={entryClass(false)}>
        <Icon className="size-5" aria-hidden="true" />
        <span className="flex-1">{label}</span>
        {path === '/inbox' && <InboxBadge />}
      </NavLink>
      {open && path in PAGE_SECTIONS && (
        <Sections page={path as SectionPage} label={t('sectionsOf', { page: t(labelKey) })} />
      )}
    </li>
  );
}

/**
 * The label of a rail entry beside it, on hover and keyboard focus (and gone with Escape). Fixed and portalled because
 * the scrolling menu would clip it; decoration only, the link keeps its own name.
 */
function useRailTip() {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const show = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setAt({ top: box.top + box.height / 2, left: box.right + 10 });
  };
  const hide = () => setAt(null);
  return {
    handlers: {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: hide,
      onKeyDown: (event: { key: string }) => event.key === 'Escape' && hide(),
    },
    render: (label: string) =>
      at &&
      createPortal(
        <span
          aria-hidden="true"
          data-rail-tip=""
          style={{ top: at.top, left: at.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs font-medium text-sidebar-foreground shadow-card"
        >
          {label}
        </span>,
        document.body,
      ),
  };
}

/** The sections (tabs) of the open page; only when there is more than one, like the page's own tab list. */
function Sections({ page, label }: { page: SectionPage; label: string }) {
  const { t } = useTranslation();
  const { t: tNav } = useTranslation('nav');
  // Section labels live in each page's own namespace (`tabs.<name>`); the key is built from PAGE_SECTIONS.
  const sectionLabel = (ns: string, name: string) =>
    (t as unknown as (key: string) => string)(`${ns}:tabs.${name}`);
  const { pathname, search } = useLocation();
  const names: string[] = useVisibleSections(page);
  const counts = useSectionCounts(page, names.length < 2 ? [] : names);
  if (names.length < 2) return null;
  const { ns, param } = PAGE_SECTIONS[page];
  const first = names[0]!;
  const chosen = new URLSearchParams(search).get(param);
  // On the page itself the current section is the one in the address (or the first); on a sub-page
  // (e.g. a review) none is current.
  const current = pathname !== page ? null : names.includes(chosen ?? '') ? chosen : first;
  return (
    <ul
      aria-label={label}
      className="relative mb-1 ml-[1.3125rem] mt-0.5 flex flex-col gap-px border-l-[1.5px] border-sidebar-border pl-3"
    >
      {names.map((name) => {
        const on = name === current;
        const waiting = counts[name];
        const shown = waiting && waiting.count > 0 ? waiting : null;
        return (
          <li key={name}>
            <Link
              to={sectionHref(page, name, first)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative flex min-h-11 items-center rounded-lg px-2.5 text-[0.8125rem] transition-colors duration-200',
                on
                  ? 'bg-sidebar-border/60 text-sidebar-foreground before:absolute before:-left-[0.84rem] before:inset-y-2 before:w-[2.5px] before:rounded-full before:bg-brand'
                  : 'text-sidebar-muted hover:bg-sidebar-border/40 hover:text-sidebar-foreground',
              )}
            >
              <span className="flex-1">{sectionLabel(ns, name)}</span>
              {shown && (
                <>
                  <span
                    aria-hidden="true"
                    className="min-w-6 rounded-full bg-brand px-1.5 text-center text-xs font-bold leading-5 tabular-nums text-sidebar"
                  >
                    {shown.count > 99 ? '99+' : shown.count}
                    {shown.more && shown.count <= 99 ? '+' : ''}
                  </span>
                  <span className="sr-only">
                    {', '}
                    {tNav('waiting', { count: shown.count })}
                  </span>
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
