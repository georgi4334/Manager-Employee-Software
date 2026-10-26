import { zodResolver } from '@hookform/resolvers/zod';
import { FEEDBACK_KINDS, FEEDBACK_VISIBILITIES } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useOwnEmployee } from '@/features/employees/hooks';
import { useChart } from '@/features/organization/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Select } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import { emptyFeedback, giveFormSchema, toCreateFeedback, type GiveFormValues } from './forms';
import { useGiveFeedback } from './hooks';
import { useFeedbackErrors } from './use-feedback-errors';

export function GiveForm({ onDone }: { onDone: (sent: boolean) => void }) {
  const { t } = useTranslation('feedback');
  const messages = useMessages();
  const errors = useFeedbackErrors();
  const give = useGiveFeedback();
  const chart = useChart();
  const own = useOwnEmployee();
  const form = useForm<GiveFormValues>({
    resolver: zodResolver(giveFormSchema),
    defaultValues: emptyFeedback(),
  });
  const e = form.formState.errors;
  const people = (chart.data?.nodes ?? []).filter((n) => n.id !== own.data?.id);

  return (
    <form
      noValidate
      className="grid gap-4"
      aria-label={t('form.title')}
      onSubmit={form.handleSubmit((v) =>
        give.mutate(toCreateFeedback(v), { onSuccess: () => onDone(true) }),
      )}
    >
      <Field label={t('form.to')} error={messages.validation(e.toEmployeeId)}>
        {(field) => (
          <Select {...field} {...form.register('toEmployeeId')}>
            <option value="">—</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('form.kind')}>
          {(field) => (
            <Select {...field} {...form.register('kind')}>
              {FEEDBACK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('form.visibility')} hint={t('form.visibilityHint')}>
          {(field) => (
            <Select {...field} {...form.register('visibility')}>
              {FEEDBACK_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`visibility.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('form.body')} error={messages.validation(e.body)}>
        {(field) => <Textarea {...field} maxLength={2000} {...form.register('body')} />}
      </Field>
      {give.isError && <Alert tone="danger">{errors.apiError(give.error)}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={give.isPending}>
          {t('form.send')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
