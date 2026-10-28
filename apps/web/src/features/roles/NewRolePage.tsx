import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { toRequest } from './forms';
import { useCreateRole } from './hooks';
import { RoleEditor } from './RoleEditor';
import { BackLink } from '@/shared/ui/back-link';

export function NewRolePage() {
  const { t } = useTranslation('roles');
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const create = useCreateRole();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink to="/roles">{t('back')}</BackLink>
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
