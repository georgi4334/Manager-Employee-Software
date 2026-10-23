import { isNotificationType } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatList } from '@/shared/lib/format';

interface NotificationTextProps {
  type: string;
  params: Record<string, unknown>;
}

const roleNames = (params: Record<string, unknown>): string[] =>
  Array.isArray(params.roleNames)
    ? params.roleNames.filter((name): name is string => typeof name === 'string')
    : [];

/**
 * The words of a notification. The server stores only the type and its parameters; the text is made here, in the
 * user's language. A type this version does not know (a newer server) still gets a sensible generic text.
 */
export function useNotificationText() {
  const { t, i18n } = useTranslation('notifications');
  const language = i18n.resolvedLanguage ?? 'en';

  return ({ type, params }: NotificationTextProps): { title: string; text: string } => {
    if (type === 'account.roles_changed' && isNotificationType(type)) {
      return {
        title: t('types.account.roles_changed.title'),
        text: t('types.account.roles_changed.text', {
          roles: formatList(roleNames(params), language),
        }),
      };
    }
    return { title: t('unknown.title'), text: t('unknown.text') };
  };
}

export function NotificationText(props: NotificationTextProps) {
  const { title, text } = useNotificationText()(props);
  return (
    <>
      <span className="block font-medium">{title}</span>
      <span className="block text-sm text-muted-foreground">{text}</span>
    </>
  );
}
