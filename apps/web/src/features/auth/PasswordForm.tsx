import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH } from '@intime/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { PasswordInput } from '@/shared/ui/password-input';
import { passwordFormSchema, type PasswordFormValues } from './forms';
import { useMessages } from './messages';

interface PasswordFormProps {
  labels: { password: string; confirm: string; hint: string; submit: string; submitting: string };
  /** Email of the account; passwords containing its name are refused (same rule as the API). */
  email: string;
  pending: boolean;
  onSubmit: (password: string) => void;
}

/** New-password form shared by "accept invitation" and "reset password". */
export function PasswordForm({ labels, email, pending, onSubmit }: PasswordFormProps) {
  const messages = useMessages();
  const schema = useMemo(() => passwordFormSchema(() => email), [email]);
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) => onSubmit(values.password))}
    >
      <Field
        label={labels.password}
        hint={labels.hint}
        error={messages.validation(errors.password)}
      >
        {(field) => (
          <PasswordInput
            {...field}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            {...form.register('password')}
          />
        )}
      </Field>
      <Field label={labels.confirm} error={messages.validation(errors.confirm)}>
        {(field) => (
          <PasswordInput {...field} autoComplete="new-password" {...form.register('confirm')} />
        )}
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
