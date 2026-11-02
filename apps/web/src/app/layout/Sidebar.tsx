import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Logo } from '@/shared/ui/logo';
import { GROUP_LABEL, groupNavItems, type NavItem } from '../nav';
import { PAGE_SECTIONS, sectionHref, useVisibleSections, type SectionPage } from '../sections';
import { useNavItems } from '../useNavItems';

const entryClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,transform] duration-300 ease-[var(--ease-standard)] active:scale-[0.98]',
    isActive
      ? 'nav-active text-sidebar-foreground'
      : 'text-sidebar-muted hover:bg-sidebar-border/60 hover:text-sidebar-foreground',
  );

/**
 * The desktop menu (docs/adr/0037-navigation-groups.md): entries under group headings, Administration set apart at the
 * bottom, and the sections of the open page as indented links under its entry.
 */
export function Sidebar() {
  const { t } = useTranslation(['common', 'nav']);
  const groups = groupNavItems(useNavItems());
  const main = groups.filter((g) => g.group !== 'admin');
  const admin = groups.find((g) => g.group === 'admin');
  return (
    <aside className="hidden bg-sidebar text-sidebar-foreground scrollbar-subtle md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto">
      <Logo className="gap-3 px-6 pb-7 pt-10 text-xl" />
      <nav aria-label={t('common:mainNavigation')} className="flex flex-1 flex-col gap-1 px-3 pb-8">
        {main.map(({ group, items }) =>
          group === 'top' ? (
            <ul key={group} className="flex flex-col gap-1">
              {items.map((item) => (
                <Entry key={item.path} item={item} />
              ))}
            </ul>
          ) : (
            <Group key={group} label={t(`nav:${GROUP_LABEL[group]}`)} items={items} />
          ),
        )}
        {admin && (
          <div className="mt-auto border-t border-sidebar-border pt-2">
            <Group label={t(`nav:${GROUP_LABEL.admin}`)} items={admin.items} />
          </div>
        )}
      </nav>
    </aside>
  );
}

function Group({ label, items }: { label: string; items: NavItem[] }) {
  const id = useId();
  return (
    <div className="mt-3">
      <p
        id={id}
        className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-sidebar-muted"
      >
        {label}
      </p>
      <ul aria-labelledby={id} className="flex flex-col gap-1">
        {items.map((item) => (
          <Entry key={item.path} item={item} />
        ))}
      </ul>
    </div>
  );
}

function Entry({ item }: { item: NavItem }) {
  const { t } = useTranslation('nav');
  const { pathname } = useLocation();
  const { path, labelKey, icon: Icon } = item;
  const open =
    path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
  return (
    <li>
      <NavLink to={path} end={path === '/'} className={entryClass}>
        <Icon className="size-5" aria-hidden="true" />
        {t(labelKey)}
      </NavLink>
      {open && path in PAGE_SECTIONS && (
        <Sections page={path as SectionPage} label={t('sectionsOf', { page: t(labelKey) })} />
      )}
    </li>
  );
}

/** The sections (tabs) of the open page; only when there is more than one, like the page's own tab list. */
function Sections({ page, label }: { page: SectionPage; label: string }) {
  const { t } = useTranslation();
  // Section labels live in each page's own namespace (`tabs.<name>`); the key is built from PAGE_SECTIONS.
  const sectionLabel = (ns: string, name: string) =>
    (t as unknown as (key: string) => string)(`${ns}:tabs.${name}`);
  const { pathname, search } = useLocation();
  const names: string[] = useVisibleSections(page);
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
              {sectionLabel(ns, name)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
