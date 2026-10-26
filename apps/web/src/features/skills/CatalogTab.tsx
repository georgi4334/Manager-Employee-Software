import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  categoryFormSchema,
  emptySkill,
  skillFormSchema,
  toCreateSkill,
  type CategoryFormValues,
  type SkillFormValues,
} from './forms';
import {
  useCatalog,
  useCreateCategory,
  useCreateSkill,
  useDeleteCategory,
  useDeleteSkill,
  useUpdateCategory,
  useUpdateSkill,
} from './hooks';
import { useSkillErrors } from './use-skill-errors';

function NewCategory() {
  const { t } = useTranslation('skills');
  const messages = useMessages();
  const errors = useSkillErrors();
  const create = useCreateCategory();
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: '' },
  });
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      aria-label={t('catalog.newCategory')}
      onSubmit={form.handleSubmit((v) =>
        create.mutate({ name: v.name.trim() }, { onSuccess: () => form.reset({ name: '' }) }),
      )}
    >
      <div className="min-w-48 flex-1">
        <Field
          label={t('catalog.categoryName')}
          error={messages.validation(form.formState.errors.name)}
        >
          {(field) => (
            <Input {...field} maxLength={60} autoComplete="off" {...form.register('name')} />
          )}
        </Field>
      </div>
      <Button type="submit" disabled={create.isPending}>
        {t('catalog.addCategory')}
      </Button>
      {create.isError && (
        <div className="w-full">
          <Alert tone="danger">{errors.apiError(create.error)}</Alert>
        </div>
      )}
    </form>
  );
}

function NewSkill({ categories }: { categories: { id: string; name: string }[] }) {
  const { t } = useTranslation('skills');
  const messages = useMessages();
  const errors = useSkillErrors();
  const create = useCreateSkill();
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: emptySkill(categories[0]?.id ?? ''),
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label={t('catalog.newSkill')}
      onSubmit={form.handleSubmit((v) =>
        create.mutate(toCreateSkill(v), {
          onSuccess: () => form.reset(emptySkill(v.categoryId)),
        }),
      )}
    >
      <Field label={t('catalog.category')} error={messages.validation(e.categoryId)}>
        {(field) => (
          <Select {...field} {...form.register('categoryId')}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('catalog.skillName')} error={messages.validation(e.name)}>
        {(field) => (
          <Input {...field} maxLength={60} autoComplete="off" {...form.register('name')} />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('catalog.description')} error={messages.validation(e.description)}>
          {(field) => (
            <Input
              {...field}
              maxLength={300}
              autoComplete="off"
              {...form.register('description')}
            />
          )}
        </Field>
      </div>
      {create.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(create.error)}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>
          {t('catalog.addSkill')}
        </Button>
      </div>
    </form>
  );
}

function CategoryRow({
  category,
}: {
  category: {
    id: string;
    name: string;
    canDelete: boolean;
    skills: {
      id: string;
      name: string;
      description: string | null;
      archived: boolean;
      canDelete: boolean;
    }[];
  };
}) {
  const { t } = useTranslation('skills');
  const messages = useMessages();
  const errors = useSkillErrors();
  const rename = useUpdateCategory();
  const removeCategory = useDeleteCategory();
  const updateSkill = useUpdateSkill();
  const removeSkill = useDeleteSkill();
  const [renaming, setRenaming] = useState(false);
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: category.name },
  });
  const error = rename.error ?? removeCategory.error ?? updateSkill.error ?? removeSkill.error;

  return (
    <Card className="space-y-3">
      {renaming ? (
        <form
          noValidate
          className="flex flex-wrap items-end gap-2"
          aria-label={t('catalog.renameCategory', { name: category.name })}
          onSubmit={form.handleSubmit((v) =>
            rename.mutate(
              { id: category.id, name: v.name.trim() },
              { onSuccess: () => setRenaming(false) },
            ),
          )}
        >
          <div className="min-w-48 flex-1">
            <Field
              label={t('catalog.categoryName')}
              error={messages.validation(form.formState.errors.name)}
            >
              {(field) => <Input {...field} maxLength={60} {...form.register('name')} />}
            </Field>
          </div>
          <Button type="submit" disabled={rename.isPending}>
            {t('catalog.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
            {t('catalog.cancel')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{category.name}</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRenaming(true)}>
              {t('catalog.rename')}
            </Button>
            {category.canDelete && (
              <Button
                variant="ghost"
                aria-label={t('catalog.deleteCategory', { name: category.name })}
                disabled={removeCategory.isPending}
                onClick={() => removeCategory.mutate(category.id)}
              >
                {t('catalog.delete')}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {category.skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('catalog.noSkills')}</p>
      ) : (
        <ul className="space-y-2" aria-label={category.name}>
          {category.skills.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {s.name}
                  {s.archived && ` (${t('archived')})`}
                </p>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={updateSkill.isPending}
                  aria-label={
                    s.archived
                      ? t('catalog.restoreSkill', { name: s.name })
                      : t('catalog.archiveSkill', { name: s.name })
                  }
                  onClick={() => updateSkill.mutate({ id: s.id, body: { archived: !s.archived } })}
                >
                  {s.archived ? t('catalog.restore') : t('catalog.archive')}
                </Button>
                {s.canDelete && (
                  <Button
                    variant="ghost"
                    disabled={removeSkill.isPending}
                    aria-label={t('catalog.deleteSkill', { name: s.name })}
                    onClick={() => removeSkill.mutate(s.id)}
                  >
                    {t('catalog.delete')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CatalogTab() {
  const { t } = useTranslation('skills');
  const errors = useSkillErrors();
  const catalog = useCatalog();
  if (catalog.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (!catalog.data) return <Alert tone="danger">{errors.apiError(catalog.error)}</Alert>;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <NewCategory />
      </Card>
      {catalog.data.categories.length > 0 && (
        <Card>
          <NewSkill categories={catalog.data.categories} />
        </Card>
      )}
      {catalog.data.categories.map((c) => (
        <CategoryRow key={c.id} category={c} />
      ))}
    </div>
  );
}
