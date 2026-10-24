import { zodResolver } from '@hookform/resolvers/zod';
import type { ChartNode, Department, Team } from '@intime/contracts';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { teamFormSchema, toTeamRequest, type TeamFormValues } from './forms';
import {
  useChart,
  useCreateTeam,
  useDeleteTeam,
  useDepartments,
  useSetTeamMembers,
  useTeams,
  useUpdateTeam,
} from './hooks';
import { PersonSelect, usePersonName } from './PersonSelect';
import { useOrgErrors } from './use-org-errors';

export function TeamsTab() {
  const { t } = useTranslation('organization');
  const errors = useOrgErrors();
  const canManage = usePermission('org.manage');
  const teams = useTeams();
  const departments = useDepartments();
  const chart = useChart();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const people = chart.data?.nodes ?? [];
  const departmentList = departments.data ?? [];
  // Forms need the people and department lists for their selects before they can show current values.
  const canEdit = canManage && chart.isSuccess && departments.isSuccess;

  if (teams.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (teams.isError) return <Alert tone="danger">{errors.apiError(teams.error)}</Alert>;
  const list = teams.data;

  return (
    <div className="space-y-3">
      {canEdit && editing !== 'new' && departmentList.length > 0 && (
        <Button onClick={() => setEditing('new')}>{t('teams.add')}</Button>
      )}
      {canEdit && editing === 'new' && (
        <TeamForm departments={departmentList} people={people} onDone={() => setEditing(null)} />
      )}
      {list.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('teams.empty')}</p>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label={t('teams.list')}>
          {list.map((team) => (
            <li key={team.id}>
              {canEdit && editing === team.id ? (
                <TeamForm
                  team={team}
                  departments={departmentList}
                  people={people}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <TeamCard
                  team={team}
                  people={people}
                  canManage={canManage}
                  onEdit={() => setEditing(team.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamCard({
  team,
  people,
  canManage,
  onEdit,
}: {
  team: Team;
  people: ChartNode[];
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('organization');
  const errors = useOrgErrors();
  const personName = usePersonName();
  const [confirming, setConfirming] = useState(false);
  const [candidate, setCandidate] = useState('');
  const remove = useDeleteTeam(team.id);
  const setMembers = useSetTeamMembers(team.id);
  const memberIds = team.members.map((m) => m.id);
  const candidates = people.filter((p) => !memberIds.includes(p.id));

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{team.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {[
              team.department.name,
              team.lead ? t('teams.lead', { name: personName(team.lead) }) : t('noLead'),
            ].join(' · ')}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              {t('actions.edit')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming((v) => !v)}>
              {t('actions.delete')}
            </Button>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">{t('teams.members')}</h3>
        {team.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('teams.noMembers')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {team.members.map((member) => (
              <li
                key={member.id}
                className="flex min-h-11 items-center gap-1 rounded-full bg-secondary pl-3 text-sm text-secondary-foreground"
              >
                <Link to={`/employees/${member.id}`} className="hover:underline">
                  {personName(member)}
                </Link>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={t('teams.removeMember', { name: personName(member) })}
                    disabled={setMembers.isPending}
                    onClick={() =>
                      setMembers.mutate({ employeeIds: memberIds.filter((id) => id !== member.id) })
                    }
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <span className="pr-3" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!candidate) return;
            setMembers.mutate(
              { employeeIds: [...memberIds, candidate] },
              { onSuccess: () => setCandidate('') },
            );
          }}
        >
          <PersonSelect
            aria-label={t('teams.addMember')}
            people={candidates}
            emptyLabel={t('teams.chooseMember')}
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!candidate || setMembers.isPending}>
            {t('teams.addMemberAction')}
          </Button>
        </form>
      )}
      {setMembers.isError && <Alert tone="danger">{errors.apiError(setMembers.error)}</Alert>}

      {confirming && (
        <div role="group" aria-label={t('deleteTitle', { name: team.name })} className="space-y-2">
          <p className="text-sm font-medium">{t('deleteTitle', { name: team.name })}</p>
          <p className="text-sm text-muted-foreground">{t('deleteText')}</p>
          {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
          <div className="flex gap-2">
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('actions.confirmDelete')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TeamForm({
  team,
  departments,
  people,
  onDone,
}: {
  team?: Team;
  departments: Department[];
  people: ChartNode[];
  onDone: () => void;
}) {
  const { t } = useTranslation('organization');
  const messages = useMessages();
  const errors = useOrgErrors();
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const mutation = team ? update : create;
  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: team?.name ?? '',
      departmentId: team?.department.id ?? departments[0]?.id ?? '',
      leadEmployeeId: team?.lead?.id ?? '',
    },
  });

  return (
    <Card>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate(toTeamRequest(values), { onSuccess: onDone }),
        )}
      >
        <Field label={t('fields.name')} error={messages.validation(form.formState.errors.name)}>
          {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
        </Field>
        <Field
          label={t('fields.department')}
          error={messages.validation(form.formState.errors.departmentId)}
        >
          {(field) => (
            <Select {...field} {...form.register('departmentId')}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('fields.lead')}>
          {(field) => (
            <PersonSelect
              {...field}
              people={people}
              emptyLabel={t('noLead')}
              {...form.register('leadEmployeeId')}
            />
          )}
        </Field>
        {mutation.isError && <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
