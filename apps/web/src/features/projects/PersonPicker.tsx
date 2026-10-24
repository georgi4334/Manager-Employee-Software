import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmployees } from '@/features/employees/hooks';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';

interface PersonPickerProps {
  label: string;
  value: string;
  onChange: (employeeId: string) => void;
  error?: string;
  /** Shown as the current choice while the search has not found it (editing). */
  current?: { id: string; name: string } | null;
  emptyLabel?: string;
}

/** Search active people by name and choose one. The directory is open to every signed-in person. */
export function PersonPicker({
  label,
  value,
  onChange,
  error,
  current,
  emptyLabel = '—',
}: PersonPickerProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const people = useEmployees({ q, status: 'active', page: 1 });
  const options = (people.data?.items ?? []).map((e) => ({
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
  }));
  if (current && !options.some((o) => o.id === current.id)) options.unshift(current);

  return (
    <div className="space-y-2">
      <Input
        type="search"
        aria-label={t('person.search', { label })}
        placeholder={t('person.search', { label })}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Field label={label} error={error}>
        {(field) => (
          <Select {...field} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{emptyLabel}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
