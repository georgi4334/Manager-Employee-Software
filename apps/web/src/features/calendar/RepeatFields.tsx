import { RECURRENCE_FREQS, addDays } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useMessages } from '@/features/auth/messages';
import { formatDay } from '@/shared/lib/format';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import type { EventFormValues } from './forms';

/** A Monday, so that weekday number n (Monday = 0) is `MONDAY + n` and Intl names it for us. */
const MONDAY = '2024-01-01';

export function RepeatFields({ form }: { form: UseFormReturn<EventFormValues> }) {
  const { t, i18n } = useTranslation('calendar');
  const messages = useMessages();
  const language = i18n.resolvedLanguage ?? 'en';
  const repeat = useWatch({ control: form.control, name: 'repeat' });
  const ends = useWatch({ control: form.control, name: 'ends' });
  const weekdays = useWatch({ control: form.control, name: 'weekdays' });
  const errors = form.formState.errors;

  const toggle = (day: number) =>
    form.setValue(
      'weekdays',
      weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day],
      { shouldDirty: true },
    );

  return (
    <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <legend className="sr-only">{t('repeat.label')}</legend>
      <Field label={t('repeat.label')}>
        {(field) => (
          <Select {...field} {...form.register('repeat')}>
            <option value="none">{t('repeat.none')}</option>
            {RECURRENCE_FREQS.map((freq) => (
              <option key={freq} value={freq}>
                {t(`repeat.freq.${freq}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {repeat !== 'none' && (
        <>
          <Field
            label={t('repeat.interval', { unit: t(`repeat.unit.${repeat}`) })}
            error={messages.validation(errors.interval)}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                {...form.register('interval')}
              />
            )}
          </Field>
          {repeat === 'weekly' && (
            <fieldset className="space-y-1 sm:col-span-2">
              <legend className="text-sm font-medium">{t('repeat.weekdays')}</legend>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                  <label
                    key={day}
                    className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={weekdays.includes(day)}
                      onChange={() => toggle(day)}
                    />
                    {formatDay(addDays(MONDAY, day), language, { weekday: 'short' })}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('repeat.weekdaysHint')}</p>
            </fieldset>
          )}
          <Field label={t('repeat.ends')}>
            {(field) => (
              <Select {...field} {...form.register('ends')}>
                <option value="never">{t('repeat.endsNever')}</option>
                <option value="until">{t('repeat.endsUntil')}</option>
                <option value="count">{t('repeat.endsCount')}</option>
              </Select>
            )}
          </Field>
          {ends === 'until' && (
            <Field label={t('repeat.until')} error={messages.validation(errors.until)}>
              {(field) => <Input {...field} type="date" {...form.register('until')} />}
            </Field>
          )}
          {ends === 'count' && (
            <Field label={t('repeat.count')} error={messages.validation(errors.count)}>
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={500}
                  {...form.register('count')}
                />
              )}
            </Field>
          )}
        </>
      )}
    </fieldset>
  );
}
