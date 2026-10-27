import { MAX_ATTENDEES } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnEmployee } from '@/features/employees/hooks';
import { useChart } from '@/features/organization/hooks';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

const SHOWN = 6;

interface GuestPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

/** Pick colleagues from the organization chart by name. Who may be invited is decided by the server. */
export function GuestPicker({ value, onChange }: GuestPickerProps) {
  const { t } = useTranslation('calendar');
  const chart = useChart();
  const own = useOwnEmployee();
  const [query, setQuery] = useState('');
  const people = (chart.data?.nodes ?? []).filter((n) => n.id !== own.data?.id);
  const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
  const selected = value
    .map((id) => people.find((p) => p.id === id))
    .filter((p) => p !== undefined);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? people
        .filter((p) => !value.includes(p.id) && name(p).toLocaleLowerCase().includes(needle))
        .slice(0, SHOWN)
    : [];
  const full = value.length >= MAX_ATTENDEES;

  return (
    <div className="space-y-2 sm:col-span-2">
      <Field
        label={t('guests.search')}
        hint={full ? t('guests.limit', { count: MAX_ATTENDEES }) : undefined}
      >
        {(field) => (
          <Input
            {...field}
            type="search"
            autoComplete="off"
            value={query}
            disabled={full}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </Field>
      {needle && matches.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('guests.noMatch')}</p>
      )}
      {matches.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('guests.results')}>
          {matches.map((p) => (
            <li key={p.id}>
              <Button
                type="button"
                variant="secondary"
                aria-label={t('guests.add', { name: name(p) })}
                onClick={() => {
                  onChange([...value, p.id]);
                  setQuery('');
                }}
              >
                {name(p)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-sm font-medium">{t('guests.label')}</p>
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('guests.none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {selected.map((p) => (
              <li key={p.id}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('guests.remove', { name: name(p) })}
                  onClick={() => onChange(value.filter((id) => id !== p.id))}
                >
                  {name(p)} ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
