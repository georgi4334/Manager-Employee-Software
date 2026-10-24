import { isNotificationType } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDay, formatList, formatNumber } from '@/shared/lib/format';

interface NotificationTextProps {
  type: string;
  params: Record<string, unknown>;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

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
    if (type === 'leave.requested') {
      const from = formatDay(str(params.startDate), language);
      const to = formatDay(str(params.endDate), language);
      const name = str(params.employeeName);
      if (params.autoApproved === true) {
        return {
          title: t('types.leave.requested.title'),
          text: t('types.leave.requested.textAuto', { name, from, to }),
        };
      }
      const days = typeof params.days === 'number' ? params.days : 0;
      return {
        title: t('types.leave.requested.title'),
        text: t('types.leave.requested.text', {
          name,
          from,
          to,
          count: days,
          days: formatNumber(days, language),
        }),
      };
    }
    if (type === 'leave.decided') {
      const range = {
        from: formatDay(str(params.startDate), language),
        to: formatDay(str(params.endDate), language),
      };
      return {
        title: t('types.leave.decided.title'),
        text:
          params.status === 'approved'
            ? t('types.leave.decided.textApproved', range)
            : t('types.leave.decided.textRejected', range),
      };
    }
    if (type === 'leave.cancelled') {
      const range = {
        from: formatDay(str(params.startDate), language),
        to: formatDay(str(params.endDate), language),
      };
      return {
        title: t('types.leave.cancelled.title'),
        text:
          params.by === 'approver'
            ? t('types.leave.cancelled.textApprover', range)
            : t('types.leave.cancelled.textEmployee', { ...range, name: str(params.employeeName) }),
      };
    }
    if (type === 'project.assigned') {
      return {
        title: t('types.project.assigned.title'),
        text: t('types.project.assigned.text', { projectName: str(params.projectName) }),
      };
    }
    if (type === 'attendance.corrected') {
      const date = formatDay(str(params.date), language);
      return {
        title: t('types.attendance.corrected.title'),
        text:
          params.action === 'created'
            ? t('types.attendance.corrected.textCreated', { date })
            : params.action === 'deleted'
              ? t('types.attendance.corrected.textDeleted', { date })
              : t('types.attendance.corrected.textUpdated', { date }),
      };
    }
    return { title: t('unknown.title'), text: t('unknown.text') };
  };
}

export function NotificationText(props: NotificationTextProps & { onAccent?: boolean }) {
  const { title, text } = useNotificationText()(props);
  return (
    <>
      <span className="block font-medium">{title}</span>
      <span className={props.onAccent ? 'block text-sm' : 'block text-sm text-muted-foreground'}>
        {text}
      </span>
    </>
  );
}
