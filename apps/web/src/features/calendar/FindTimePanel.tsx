import { addDays } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useOwnEmployee } from '@/features/employees/hooks';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Select } from '@/shared/ui/select';
import { useFindTime } from './hooks';

const DURATIONS = [30, 60, 90, 120];
const DAYS = 7;

interface FindTimePanelProps {
  /** The first day to look at. */
  from: string;
  guestIds: string[];
  onPick: (slot: { date: string; startTime: string; endTime: string }) => void;
}

/** Suggests times when you and the guests are free (slots only; the server never says why anyone is busy). */
export function FindTimePanel({ from, guestIds, onPick }: FindTimePanelProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const own = useOwnEmployee();
  const search = useFindTime();
  const [duration, setDuration] = useState(60);

  const run = () => {
    if (!own.data) return;
    search.mutate({
      employeeIds: [own.data.id, ...guestIds],
      from,
      to: addDays(from, DAYS - 1),
      durationMinutes: duration,
    });
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-background p-3 sm:col-span-2"
      aria-label={t('findTime.title')}
    >
      <p className="text-sm text-muted-foreground">{t('findTime.hint', { count: DAYS })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <Field label={t('findTime.duration')}>
            {(field) => (
              <Select
                {...field}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {t('findTime.minutes', { count: m })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button type="button" onClick={run} disabled={search.isPending || !own.data}>
          {search.isPending ? t('findTime.searching') : t('findTime.search')}
        </Button>
      </div>
      {search.isError && <Alert tone="danger">{messages.apiError(search.error)}</Alert>}
      {search.data && search.data.slots.length === 0 && (
        <p className="text-sm">{t('findTime.none')}</p>
      )}
      {search.data && search.data.slots.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('findTime.results')}>
          {search.data.slots.map((slot) => (
            <li key={`${slot.date}${slot.startTime}`}>
              <Button type="button" variant="secondary" onClick={() => onPick(slot)}>
                {t('findTime.slot', {
                  date: formatDay(slot.date, language, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }),
                  start: slot.startTime,
                  end: slot.endTime,
                })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
