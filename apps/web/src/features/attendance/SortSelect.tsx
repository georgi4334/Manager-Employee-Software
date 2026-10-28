import type { AttendanceSort, PresenceSort } from '@intime/contracts';
import { ArrowUpDown } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui/select';

/** "Sort by" for an attendance list; the options are keys of `sort.*`. */
export function SortSelect<T extends AttendanceSort | PresenceSort>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation('attendance');
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowUpDown className="size-4" aria-hidden="true" />
        {t('sort.label')}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-auto min-w-44"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`sort.${option}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}
