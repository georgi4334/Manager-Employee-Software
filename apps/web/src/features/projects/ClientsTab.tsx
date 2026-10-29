import { zodResolver } from '@hookform/resolvers/zod';
import type { Client } from '@intime/contracts';
import { Briefcase, Mail, User } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { Chip, Tile, initials } from '@/shared/ui/tiles';
import { clientFormSchema, toCreateClient, toUpdateClient, type ClientFormValues } from './forms';
import { useClients, useCreateClient, useUpdateClient } from './hooks';
import { useProjectErrors } from './use-project-errors';

/** The clients of the company: managers read, HR and Admin change. */
export function ClientsTab() {
  const { t } = useTranslation('projects');
  const errors = useProjectErrors();
  const canManage = usePermission('client.manage');
  const clients = useClients();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('clients.title')}</h2>
        {canManage && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('clients.add')}
          </Button>
        )}
      </div>
      {adding && (
        <Card className="space-y-3">
          <CardTitle>{t('clients.add')}</CardTitle>
          <ClientForm onDone={() => setAdding(false)} />
        </Card>
      )}
      {clients.isPending && (
        <SkeletonGroup label={t('loading')} className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="space-y-3 rounded-xl glass p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {clients.isError && <Alert tone="danger">{errors.apiError(clients.error)}</Alert>}
      {clients.data && clients.data.items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('clients.empty')}</p>
        </Card>
      )}
      {clients.data && clients.data.items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('clients.title')}>
          {clients.data.items.map((client) => (
            <ClientRow key={client.id} client={client} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientRow({ client, canManage }: { client: Client; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const errors = useProjectErrors();
  const update = useUpdateClient(client.id);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-xl glass p-4 sm:col-span-2">
        <ClientForm client={client} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-4 rounded-xl glass p-4">
      <div className="flex items-start gap-3">
        <Tile>{initials(client.name)}</Tile>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-semibold leading-snug">{client.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip>
              <Briefcase className="size-3" aria-hidden="true" />
              {t('clients.projects', { count: client.projectCount })}
            </Chip>
            {client.status === 'archived' && (
              <Chip className="border border-warning bg-transparent text-warning">
                {t('clients.archived')}
              </Chip>
            )}
          </div>
        </div>
      </div>
      {(client.contactName || client.contactEmail) && (
        <div className="space-y-1.5 text-sm">
          {client.contactName && (
            <p className="flex items-center gap-2">
              <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-words">{client.contactName}</span>
            </p>
          )}
          {client.contactEmail && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{client.contactEmail}</span>
            </p>
          )}
        </div>
      )}
      {client.notes && (
        <p className="line-clamp-2 break-words text-sm text-muted-foreground">{client.notes}</p>
      )}
      {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
      {canManage && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('clients.edit')}
          </Button>
          <Button
            variant="ghost"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ status: client.status === 'active' ? 'archived' : 'active' })
            }
          >
            {client.status === 'active' ? t('clients.archive') : t('clients.restore')}
          </Button>
        </div>
      )}
    </li>
  );
}

function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { t } = useTranslation('projects');
  const messages = useMessages();
  const errors = useProjectErrors();
  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? '');
  const mutation = client ? update : create;
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: client?.name ?? '',
      contactName: client?.contactName ?? '',
      contactEmail: client?.contactEmail ?? '',
      notes: client?.notes ?? '',
    },
  });
  const fieldErrors = form.formState.errors;
  const submit = (v: ClientFormValues) => {
    if (client) update.mutate(toUpdateClient(v), { onSuccess: onDone });
    else create.mutate(toCreateClient(v), { onSuccess: onDone });
  };

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(submit)}
      aria-label={client ? t('clients.edit') : t('clients.add')}
    >
      <div className="sm:col-span-2">
        <Field label={t('clients.name')} error={messages.validation(fieldErrors.name)}>
          {(field) => (
            <Input {...field} maxLength={120} autoComplete="off" {...form.register('name')} />
          )}
        </Field>
      </div>
      <Field label={t('clients.contactName')} error={messages.validation(fieldErrors.contactName)}>
        {(field) => (
          <Input {...field} maxLength={100} autoComplete="off" {...form.register('contactName')} />
        )}
      </Field>
      <Field
        label={t('clients.contactEmail')}
        error={messages.validation(fieldErrors.contactEmail)}
      >
        {(field) => (
          <Input {...field} type="email" autoComplete="off" {...form.register('contactEmail')} />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('clients.notes')} error={messages.validation(fieldErrors.notes)}>
          {(field) => (
            <Input {...field} maxLength={1000} autoComplete="off" {...form.register('notes')} />
          )}
        </Field>
      </div>
      {mutation.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
