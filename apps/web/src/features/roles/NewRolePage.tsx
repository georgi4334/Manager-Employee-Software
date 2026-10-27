import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { toRequest } from './forms';
import { useCreateRole } from './hooks';
import { RoleEditor } from './RoleEditor';

export function NewRolePage() {
  const { t } = useTranslation('roles');
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const create = useCreateRole();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/roles" className="text-sm text-primary underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('form.newTitle')}</h1>
      <RoleEditor
        mine={user?.permissions}
        pending={create.isPending}
        error={create.error}
        onSubmit={(values) =>
          create.mutate(toRequest(values), { onSuccess: (role) => navigate(`/roles/${role.id}`) })
        }
        onCancel={() => navigate('/roles')}
      />
    </div>
  );
}
