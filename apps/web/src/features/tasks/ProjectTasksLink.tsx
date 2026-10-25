import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Card, CardTitle } from '@/shared/ui/card';
import { useTasks } from './hooks';

/** On the project page: the number of open tasks and a link to them. */
export function ProjectTasksLink({ projectId }: { projectId: string }) {
  const { t } = useTranslation('tasks');
  const allowed = usePermission('task.view');
  const open = useTasks(
    { projectId, mine: false, status: 'open', type: 'all', q: '', page: 1, pageSize: 1 },
    allowed,
  );
  if (!allowed) return null;
  return (
    <Card className="space-y-2">
      <CardTitle>{t('title')}</CardTitle>
      <p className="text-sm text-muted-foreground">
        {open.data ? t('link.open', { count: open.data.total }) : t('loading')}
      </p>
      <Link
        to={`/tasks?project=${projectId}`}
        className="inline-flex min-h-11 items-center text-sm text-primary underline"
      >
        {t('link.go')}
      </Link>
    </Card>
  );
}
