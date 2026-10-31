import type { RoleListItem } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Modal } from '@/shared/ui/modal';
import { Select } from '@/shared/ui/select';
import { useMoveRole } from './hooks';
import { parentOptions } from './tree';
import { useRoleErrors } from './use-role-errors';

interface MoveProps {
  /** The role being moved; the dialog is closed while null. */
  role: RoleListItem | null;
  roles: readonly RoleListItem[];
  onClose: () => void;
}

/** Puts a role under another one (ADR 0036). Display only: the dialog says no permission changes. */
export function MoveRoleDialog({ role, roles, onClose }: MoveProps) {
  const { t } = useTranslation('roles');
  return (
    <Modal
      open={role !== null}
      onClose={onClose}
      title={role ? t('move.title', { name: role.name }) : ''}
      subtitle={t('move.hint')}
    >
      {role && <MoveForm key={role.id} role={role} roles={roles} onClose={onClose} />}
    </Modal>
  );
}

function MoveForm({
  role,
  roles,
  onClose,
}: {
  role: RoleListItem;
  roles: readonly RoleListItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation('roles');
  const errors = useRoleErrors();
  const move = useMoveRole();
  const [parentId, setParentId] = useState(role.parentId ?? '');
  const options = parentOptions(roles, role.id);

  return (
    <form
      noValidate
      className="space-y-4"
      aria-label={t('move.title', { name: role.name })}
      onSubmit={(e) => {
        e.preventDefault();
        move.mutate({ id: role.id, parentId: parentId || null }, { onSuccess: onClose });
      }}
    >
      <Field label={t('form.parent')}>
        {(field) => (
          <Select {...field} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('move.top')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.path}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {move.isError && <Alert tone="danger">{errors.apiError(move.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={move.isPending}>
          {move.isPending ? t('move.saving') : t('move.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
