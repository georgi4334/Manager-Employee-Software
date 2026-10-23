import type { ChartNode } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Select, type SelectProps } from '@/shared/ui/select';

/** A select of active employees (from the chart data) with an empty choice. */
export function PersonSelect({
  people,
  emptyLabel,
  exclude,
  ...props
}: SelectProps & { people: readonly ChartNode[]; emptyLabel: string; exclude?: string }) {
  return (
    <Select {...props}>
      <option value="">{emptyLabel}</option>
      {people
        .filter((person) => person.id !== exclude)
        .map((person) => (
          <option key={person.id} value={person.id}>
            {person.firstName} {person.lastName}
          </option>
        ))}
    </Select>
  );
}

export function usePersonName() {
  const { t } = useTranslation('organization');
  return (person: { firstName: string; lastName: string } | null | undefined, empty?: string) =>
    person ? `${person.firstName} ${person.lastName}` : (empty ?? t('none'));
}
