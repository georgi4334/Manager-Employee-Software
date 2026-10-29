import type { OneOnOneSummary } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDay } from '@/shared/lib/format';

export function MeetingCard({ meeting }: { meeting: OneOnOneSummary }) {
  const { t, i18n } = useTranslation('meetings');
  const language = i18n.resolvedLanguage ?? 'en';
  const person = `${meeting.other.firstName} ${meeting.other.lastName}`;
  return (
    <li className="space-y-1 rounded-xl glass p-4">
      <Link to={`/one-on-ones/${meeting.id}`} className="font-medium text-primary underline">
        {t('card.with', { name: person })}
      </Link>
      <p className="text-sm text-muted-foreground">
        {formatDay(meeting.date, language)} · {meeting.time}
        {' · '}
        {t('card.minutes', { count: meeting.durationMinutes })}
        {' · '}
        {t(`status.${meeting.status}`)}
        {meeting.openActionItems > 0 &&
          ` · ${t('card.openItems', { count: meeting.openActionItems })}`}
      </p>
      <p className="text-sm text-muted-foreground">{t(`role.${meeting.role}`)}</p>
    </li>
  );
}
