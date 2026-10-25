import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { useProjects } from '@/features/projects/hooks';
import { useTasks } from '@/features/tasks/hooks';
import { Field } from '@/shared/ui/field';
import { Select } from '@/shared/ui/select';

interface TargetFieldsProps {
  projectId: string;
  taskId: string;
  onProject: (id: string) => void;
  onTask: (id: string) => void;
  projectError?: string;
  /** The project and task already on the entry, shown even when the lists no longer offer them. */
  current?: {
    project: { id: string; code: string; name: string };
    task: { id: string; key: string } | null;
  };
}

/** The project (work in progress, the person is on) and optional task to charge time to. */
export function TargetFields({
  projectId,
  taskId,
  onProject,
  onTask,
  projectError,
  current,
}: TargetFieldsProps) {
  const { t } = useTranslation('time');
  const seesTasks = usePermission('task.view');
  const projects = useProjects({ q: '', status: 'all', clientId: '', page: 1 });
  const tasks = useTasks(
    { projectId, mine: false, status: 'open', type: 'all', q: '', page: 1, pageSize: 200 },
    seesTasks && projectId !== '',
  );
  const projectOptions = (projects.data?.items ?? [])
    .filter((p) => p.status !== 'done' || p.id === current?.project.id)
    .map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
  if (current && !projectOptions.some((o) => o.id === current.project.id)) {
    projectOptions.unshift({
      id: current.project.id,
      label: `${current.project.code} · ${current.project.name}`,
    });
  }
  const taskOptions = (tasks.data?.items ?? []).map((task) => ({
    id: task.id,
    label: `${task.key} · ${task.title}`,
  }));
  if (
    current?.task &&
    current.project.id === projectId &&
    !taskOptions.some((o) => o.id === current.task!.id)
  ) {
    taskOptions.unshift({ id: current.task.id, label: current.task.key });
  }

  return (
    <>
      <Field label={t('form.project')} error={projectError}>
        {(field) => (
          <Select
            {...field}
            value={projectId}
            onChange={(e) => {
              onProject(e.target.value);
              onTask('');
            }}
          >
            <option value="">—</option>
            {projectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {seesTasks && (
        <Field label={t('form.task')}>
          {(field) => (
            <Select
              {...field}
              value={taskId}
              disabled={projectId === ''}
              onChange={(e) => onTask(e.target.value)}
            >
              <option value="">{t('form.noTask')}</option>
              {taskOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </>
  );
}
