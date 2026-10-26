import { zodResolver } from '@hookform/resolvers/zod';
import type { Competency } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { partSchema, toManagerRequest, toSelfRequest, unscored, type PartValues } from './forms';
import { useWriteManager, useWriteSelf } from './hooks';
import { ScoreSelect } from './ScoreSelect';
import { useReviewErrors } from './use-review-errors';

interface PartEditorProps {
  reviewId: string;
  kind: 'self' | 'manager';
  competencies: Competency[];
  initial: PartValues;
}

/** Writing one part: a score and a comment per competency, a summary, and for the manager an overall rating. */
export function PartEditor({ reviewId, kind, competencies, initial }: PartEditorProps) {
  const { t } = useTranslation('reviews');
  const messages = useMessages();
  const errors = useReviewErrors();
  const writeSelf = useWriteSelf(reviewId);
  const writeManager = useWriteManager(reviewId);
  const mutation = kind === 'self' ? writeSelf : writeManager;
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<PartValues>({ resolver: zodResolver(partSchema), defaultValues: initial });
  const e = form.formState.errors;

  const send = (submit: boolean) =>
    form.handleSubmit((values) => {
      setProblem(null);
      setSaved(false);
      if (submit) {
        if (unscored(values, competencies).length > 0) return setProblem(t('rule.incomplete'));
        if (kind === 'manager' && !values.overall) return setProblem(t('rule.required'));
      }
      const onSuccess = () => setSaved(!submit);
      if (kind === 'self') {
        writeSelf.mutate({ body: toSelfRequest(values, competencies), submit }, { onSuccess });
      } else {
        writeManager.mutate(
          { body: toManagerRequest(values, competencies), submit },
          { onSuccess },
        );
      }
    })();

  return (
    <form
      noValidate
      className="space-y-4"
      aria-label={kind === 'self' ? t('self.editTitle') : t('manager.editTitle')}
      onSubmit={(ev) => ev.preventDefault()}
    >
      <ul className="space-y-3">
        {competencies.map((c) => (
          <li key={c.id} className="space-y-2 rounded-lg border border-border p-3">
            <p className="font-medium">{c.name}</p>
            {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('score.label', { name: c.name })}>
                {(field) => (
                  <ScoreSelect
                    {...field}
                    emptyLabel={t('score.none')}
                    {...form.register(`scores.${c.id}`)}
                  />
                )}
              </Field>
              <Field
                label={t('comment.label', { name: c.name })}
                error={messages.validation(e.comments?.[c.id])}
              >
                {(field) => (
                  <Input
                    {...field}
                    maxLength={500}
                    autoComplete="off"
                    {...form.register(`comments.${c.id}`)}
                  />
                )}
              </Field>
            </div>
          </li>
        ))}
      </ul>
      <Field label={t('summary.label')} error={messages.validation(e.summary)}>
        {(field) => <Textarea {...field} maxLength={2000} {...form.register('summary')} />}
      </Field>
      {kind === 'manager' && (
        <Field
          label={t('manager.overall')}
          hint={t('manager.overallHint')}
          error={messages.validation(e.overall)}
        >
          {(field) => (
            <ScoreSelect {...field} emptyLabel={t('score.none')} {...form.register('overall')} />
          )}
        </Field>
      )}
      {problem && <Alert tone="danger">{problem}</Alert>}
      {mutation.isError && <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('draftSaved')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => void send(false)}
        >
          {t('saveDraft')}
        </Button>
        <Button type="button" disabled={mutation.isPending} onClick={() => void send(true)}>
          {t('submit')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('submitHint')}</p>
    </form>
  );
}
