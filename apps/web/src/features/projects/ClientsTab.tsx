import { zodResolver } from '@hookform/resolvers/zod';
import type { Client } from '@intime/contracts';
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
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {clients.isError && <Alert tone="danger">{errors.apiError(clients.error)}</Alert>}
      {clients.data && clients.data.items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('clients.empty')}</p>
        </Card>
      )}
      {clients.data && clients.data.items.length > 0 && (
        <ul className="space-y-2" aria-label={t('clients.title')}>
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
      <li className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <ClientForm client={client} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{client.name}</p>
          <p className="text-sm text-muted-foreground">
            {t('clients.projects', { count: client.projectCount })}
          </p>
          {client.contactName && <p className="text-sm">{client.contactName}</p>}
          {client.contactEmail && (
            <p className="text-sm text-muted-foreground">{client.contactEmail}</p>
          )}
          {client.notes && <p className="text-sm">{client.notes}</p>}
        </div>
        {client.status === 'archived' && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {t('clients.archived')}
          </span>
        )}
      </div>
      {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
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
