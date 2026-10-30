import { PERMISSION_MODULES, type PermissionModule, type RoleListItem } from '@intime/contracts';
import { ChevronDown, ChevronRight, GitBranch, KeyRound, MoveRight, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/tiles';
import type { RoleNode } from './tree';

/** Each top-level branch gets one accent (decoration only; the badge says System/Custom in words). */
const ACCENTS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-6',
  'bg-chart-7',
];
const MAX_MODULES = 4;

interface TreeProps {
  nodes: RoleNode[];
  canManage: boolean;
  onMove: (role: RoleListItem) => void;
}

/**
 * The roles as an org chart (ADR 0036): every root on top with its direct sub-roles as columns below, deeper levels
 * stacked inside a column along a line. On a phone the columns stack, so nothing scrolls sideways.
 */
export function RoleTree({ nodes, canManage, onMove }: TreeProps) {
  const { t } = useTranslation('roles');
  return (
    <ul aria-label={t('tree.label')} className="space-y-8">
      {nodes.map((root, index) => (
        <li key={root.role.id} className="space-y-0">
          <Branch
            node={root}
            accent={ACCENTS[index % ACCENTS.length]!}
            canManage={canManage}
            onMove={onMove}
            top
          />
        </li>
      ))}
    </ul>
  );
}

interface BranchProps {
  node: RoleNode;
  accent: string;
  canManage: boolean;
  onMove: (role: RoleListItem) => void;
  /** A root: its sub-roles spread out as columns. */
  top?: boolean;
}

function Branch({ node, accent, canManage, onMove, top }: BranchProps) {
  const { t } = useTranslation('roles');
  const [open, setOpen] = useState(true);
  const children = node.children;
  const listId = `role-children-${node.role.id}`;

  const card = (
    <RoleCard
      role={node.role}
      accent={accent}
      subRoles={children.length}
      canManage={canManage}
      onMove={onMove}
      toggle={
        children.length > 0 ? (
          <Button
            variant="ghost"

            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
            <span aria-hidden="true">{open ? t('card.hide') : t('card.show')}</span>
            <span className="sr-only">
              {open
                ? t('card.collapse', { name: node.role.name })
                : t('card.expand', { name: node.role.name })}
            </span>
          </Button>
        ) : undefined
      }
    />
  );

  if (top) {
    return (
      <div>
        <div className="mx-auto max-w-sm">{card}</div>
        {children.length > 0 && open && (
          <>
            <span aria-hidden="true" className="mx-auto block h-6 w-px bg-border" />
            {/* Org-chart connectors on wider screens: each column draws its half of the bar and a stub down. */}
            <ul
              id={listId}
              aria-label={t('tree.below', { name: node.role.name })}
              className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-0 sm:gap-y-6"
            >
              {children.map((child, index) => (
                <li
                  key={child.role.id}
                  className={cn(
                    'relative min-w-0 sm:w-80 sm:px-2 sm:pt-6',
                    'sm:before:absolute sm:before:left-0 sm:before:top-0 sm:before:h-px sm:before:w-1/2 sm:before:bg-border',
                    'sm:after:absolute sm:after:right-0 sm:after:top-0 sm:after:h-px sm:after:w-1/2 sm:after:bg-border',
                    index === 0 && 'sm:before:hidden',
                    index === children.length - 1 && 'sm:after:hidden',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-0 hidden h-6 w-px bg-border sm:block"
                  />
                  <Branch
                    node={child}
                    accent={ACCENTS[(index + 1) % ACCENTS.length]!}
                    canManage={canManage}
                    onMove={onMove}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {card}
      {children.length > 0 && open && (
        <ul
          id={listId}
          aria-label={t('tree.below', { name: node.role.name })}
          className="ml-2 space-y-3 border-l border-border pl-3"
        >
          {children.map((child) => (
            <li key={child.role.id} className="relative min-w-0">
              <span aria-hidden="true" className="absolute -left-3 top-8 h-px w-3 bg-border" />
              <Branch node={child} accent={accent} canManage={canManage} onMove={onMove} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CardProps {
  role: RoleListItem;
  accent: string;
  subRoles: number;
  canManage: boolean;
  onMove: (role: RoleListItem) => void;
  toggle?: ReactNode;
}

function RoleCard({ role, accent, subRoles, canManage, onMove, toggle }: CardProps) {
  const { t } = useTranslation('roles');
  const modules = role.modules.filter((m): m is PermissionModule =>
    (PERMISSION_MODULES as readonly string[]).includes(m),
  );
  const shown = modules.slice(0, MAX_MODULES);

  return (
    <article
      aria-label={role.name}
      className="relative overflow-hidden rounded-xl glass glass-hover p-4 pl-5"
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1.5', accent)} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          to={`/roles/${role.id}`}
          className="min-w-0 break-words text-base font-semibold leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {role.name}
        </Link>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {role.isSystem ? t('system') : t('custom')}
        </span>
      </div>
      {role.description && (
        <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
          {role.description}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Figure icon={Users} text={t('card.people', { count: role.userCount })} />
        <Figure icon={KeyRound} text={t('card.permissions', { count: role.permissionCount })} />
        <Figure icon={GitBranch} text={t('card.subRoles', { count: subRoles })} />
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {modules.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t('card.noModules')}</span>
        ) : (
          <>
            {shown.map((m) => (
              <Chip key={m}>{t(`modules.${m}`)}</Chip>
            ))}
            {modules.length > shown.length && (
              <Chip>{t('card.moreModules', { count: modules.length - shown.length })}</Chip>
            )}
          </>
        )}
      </div>
      {(toggle || canManage) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {toggle ?? <span />}
          {canManage && (
            <Button variant="secondary" onClick={() => onMove(role)}>
              <MoveRight className="size-4" aria-hidden="true" />
              {t('card.move')}
              <span className="sr-only">{role.name}</span>
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function Figure({ icon: Icon, text }: { icon: typeof Users; text: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="tabular-nums">{text}</span>
    </li>
  );
}
