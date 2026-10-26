import { useTranslation } from 'react-i18next';
import { Select, type SelectProps } from '@/shared/ui/select';

const SCORES = ['1', '2', '3', '4', '5'] as const;

/** A score from 1 to 5, with the words next to the number. */
export function ScoreSelect({ emptyLabel, ...props }: SelectProps & { emptyLabel: string }) {
  const { t } = useTranslation('reviews');
  return (
    <Select {...props}>
      <option value="">{emptyLabel}</option>
      {SCORES.map((s) => (
        <option key={s} value={s}>
          {s} · {t(`score.${s}`)}
        </option>
      ))}
    </Select>
  );
}
