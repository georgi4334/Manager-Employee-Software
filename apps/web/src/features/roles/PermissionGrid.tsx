import {
  PERMISSIONS,
  PERMISSION_MODULES,
  type GrantedPermissions,
  type PermissionCode,
  type PermissionModule,
  type PermissionScope,
} from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui/select';
import { mayGrant, scopesFor } from './forms';

interface GridProps {
  /** Permission code to scope; '' or missing = no access. */
  value: Record<string, string>;
  /** The signed-in user's own permissions: what they may hand out (the server checks again). */
  mine: GrantedPermissions | undefined;
  /** Read-only: shown as words, no controls. */
  readOnly?: boolean;
  onChange?: (next: Record<string, string>) => void;
}

const byModule = (module: PermissionModule) => PERMISSIONS.filter((p) => p.module === module);

/** The permissions of a role, grouped by module: a scope per permission, or a plain list when read-only. */
export function PermissionGrid({ value, mine, readOnly, onChange }: GridProps) {
  const { t } = useTranslation('roles');
  const set = (code: string, scope: string) => onChange?.({ ...value, [code]: scope });

  return (
    <div className="space-y-3">
      {PERMISSION_MODULES.map((module) => {
        const permissions = byModule(module);
        const granted = permissions.filter((p) => value[p.code]);
        // A read-only view only shows modules that have something in them.
        if (readOnly && granted.length === 0) return null;
        return (
          <details
            key={module}
            open={readOnly ? true : granted.length > 0}
            className="rounded-xl border border-border bg-surface"
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
              <span>{t(`modules.${module}`)}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t('grid.count', { count: granted.length, total: permissions.length })}
              </span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {permissions.map((p) => {
                const code = p.code as PermissionCode;
                const current = value[code] ?? '';
                const label = t(`permissions.${code}`);
                const held = mine?.[code] !== undefined;
                return (
                  <li
                    key={code}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-sm">{label}</span>
                    {readOnly ? (
                      <span className="text-sm font-medium">
                        {t(`scopes.${current as PermissionScope}`)}
                      </span>
                    ) : (
                      <div className="sm:w-64">
                        <Select
                          aria-label={label}
                          value={current}
                          onChange={(e) => set(code, e.target.value)}
                          disabled={!held && current === ''}
                        >
                          <option value="">{t('grid.noAccess')}</option>
                          {scopesFor(code).map((scope) => (
                            <option
                              key={scope}
                              value={scope}
                              // what is already there stays selectable; anything new or wider needs to be held
                              disabled={scope !== current && !mayGrant(mine, code, scope)}
                            >
                              {t(`scopes.${scope}`)}
                            </option>
                          ))}
                        </Select>
                        {!held && current === '' && (
                          <p className="mt-1 text-xs text-muted-foreground">{t('grid.notHeld')}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
