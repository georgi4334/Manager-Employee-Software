import { zodResolver } from '@hookform/resolvers/zod';
import { CHECKLIST_KINDS, CHECKLIST_LIMITS, CHECKLIST_RESPONSIBLES } from '@intime/contracts';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { BackLink } from '@/shared/ui/back-link';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { SkeletonCard, SkeletonGroup } from '@/shared/ui/skeleton';
import {
  emptyStep,
  templateFormSchema,
  templateValues,
  toTemplateRequest,
  type TemplateFormValues,
} from './forms';
import { useDeleteTemplate, useSaveTemplate, useTemplate } from './hooks';
import { useChecklistErrors } from './use-checklist-errors';

const BACK = '/checklists?tab=templates';

/** Create (`/checklists/templates/new`) or change (`/checklists/templates/:id`) a template. */
export function TemplateEditorPage() {
  const { id } = useParams();
  const { t } = useTranslation('checklists');
  const errors = useChecklistErrors();
  const query = useTemplate(id ?? '', Boolean(id));

  if (id && query.isPending)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink to={BACK}>{t('editor.back')}</BackLink>
        <SkeletonGroup label={t('loading')}>
          <SkeletonCard rows={5} />
        </SkeletonGroup>
      </div>
    );
  if (id && query.isError)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink to={BACK}>{t('editor.back')}</BackLink>
        {isApiError(query.error, 'NOT_FOUND') ? (
          <h1 className="text-2xl font-semibold">{t('editor.notFound')}</h1>
        ) : (
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
        )}
      </div>
    );
  return <Editor key={id ?? 'new'} id={id ?? null} initial={templateValues(query.data)} />;
}

function Editor({ id, initial }: { id: string | null; initial: TemplateFormValues }) {
  const { t } = useTranslation('checklists');
  const { t: tv } = useTranslation('errors');
  const navigate = useNavigate();
  const errors = useChecklistErrors();
  const save = useSaveTemplate(id);
  const remove = useDeleteTemplate();
  const [confirming, setConfirming] = useState(false);
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: initial,
  });
  const steps = useFieldArray({ control: form.control, name: 'items' });
  const fe = form.formState.errors;
  const err = (key?: string) =>
    key ? tv(`validation.${key}` as 'validation.required') : undefined;
  const watched = useWatch({ control: form.control, name: 'items' });
  const label = (i: number) => watched?.[i]?.title?.trim() || t('editor.stepTitle', { n: i + 1 });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink to={BACK}>{t('editor.back')}</BackLink>
      <h1 className="text-2xl font-semibold">
        {id ? t('editor.editTitle') : t('editor.newTitle')}
      </h1>
      <form
        noValidate
        className="space-y-5"
        onSubmit={form.handleSubmit((values) =>
          save.mutate(toTemplateRequest(values), { onSuccess: () => void navigate(BACK) }),
        )}
      >
        <Card className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t('editor.name')} error={err(fe.name?.message)}>
              {(p) => <Input {...p} {...form.register('name')} />}
            </Field>
          </div>
          <Field label={t('editor.kind')}>
            {(p) => (
              <Select {...p} {...form.register('kind')}>
                {CHECKLIST_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end text-sm font-medium">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              {...form.register('isDefault')}
            />
            {t('editor.isDefault')}
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {t('templates.defaultHint')}
          </p>
        </Card>

        <section aria-labelledby="template-steps" className="space-y-3">
          <h2 id="template-steps" className="text-base font-semibold">
            {t('editor.steps')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('editor.offsetHint')}</p>
          <ol className="space-y-3">
            {steps.fields.map((field, i) => {
              const se = fe.items?.[i];
              return (
                <li key={field.id}>
                  <Card className="grid gap-3 sm:grid-cols-[1fr_12rem_8rem]">
                    <div className="sm:col-span-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {t('editor.stepTitle', { n: i + 1 })}
                      </h3>
                      <div className="flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('editor.moveUp', { title: label(i) })}
                          disabled={i === 0}
                          onClick={() => steps.move(i, i - 1)}
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('editor.moveDown', { title: label(i) })}
                          disabled={i === steps.fields.length - 1}
                          onClick={() => steps.move(i, i + 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('editor.remove', { title: label(i) })}
                          onClick={() => steps.remove(i)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <Field label={t('detail.title')} error={err(se?.title?.message)}>
                      {(p) => <Input {...p} {...form.register(`items.${i}.title`)} />}
                    </Field>
                    <Field label={t('detail.responsible')}>
                      {(p) => (
                        <Select {...p} {...form.register(`items.${i}.responsible`)}>
                          {CHECKLIST_RESPONSIBLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`responsible.${r}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('editor.offset')} error={err(se?.offsetDays?.message)}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="numeric"
                          {...form.register(`items.${i}.offsetDays`)}
                        />
                      )}
                    </Field>
                    <div className="sm:col-span-3">
                      <Field label={t('detail.description')} error={err(se?.description?.message)}>
                        {(p) => <Input {...p} {...form.register(`items.${i}.description`)} />}
                      </Field>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
          {steps.fields.length < CHECKLIST_LIMITS.items && (
            <Button type="button" variant="secondary" onClick={() => steps.append(emptyStep())}>
              <Plus className="size-4" aria-hidden="true" />
              {t('editor.addStep')}
            </Button>
          )}
        </section>

        {save.isError && <Alert tone="danger">{errors.apiError(save.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t('editor.save')}
          </Button>
          {id && !confirming && (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              onClick={() => setConfirming(true)}
            >
              {t('editor.delete')}
            </Button>
          )}
        </div>
      </form>
      {id && confirming && (
        <Card className="space-y-3">
          <p className="font-medium">{t('editor.confirmDelete')}</p>
          {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(id, { onSuccess: () => void navigate(BACK) })}
            >
              {t('editor.yesDelete')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
