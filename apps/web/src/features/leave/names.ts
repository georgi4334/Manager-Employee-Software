import { isBuiltInHolidayKey, type Holiday, type LeaveType } from '@intime/contracts';
import { useTranslation } from 'react-i18next';

type TypeLike = Pick<LeaveType, 'key' | 'name'>;

/** The display name of a leave type: system types are translated, custom types carry their own name. */
export function useTypeName() {
  const { t } = useTranslation('leave');
  return (type: TypeLike): string => (type.key ? t(`types.${type.key}`) : (type.name ?? ''));
}

/** The display name of a holiday: built-in days are translated, company days carry their own name. */
export function useHolidayName() {
  const { t } = useTranslation('leave');
  return (holiday: Pick<Holiday, 'key' | 'name' | 'compensates'>): string => {
    if (!holiday.key) return holiday.name ?? '';
    if (!isBuiltInHolidayKey(holiday.key)) return holiday.key;
    if (holiday.compensates && isBuiltInHolidayKey(holiday.compensates)) {
      return t('settings.holidays.compensation', { name: t(`holiday.${holiday.compensates}`) });
    }
    return t(`holiday.${holiday.key}`);
  };
}
