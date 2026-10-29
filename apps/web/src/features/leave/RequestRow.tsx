import type { LeaveRequest } from '@intime/contracts';
import { ConflictsPanel } from './ConflictsPanel';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { useDecideRequest } from './hooks';
import { useTypeName } from './names';
import { useLeaveErrors } from './use-leave-errors';

const STATUS_STYLE: Record<LeaveRequest['status'], string> = {
  pending: 'bg-secondary text-secondary-foreground',
  approved: 'border border-success text-success',
  rejected: 'border border-danger text-danger',
  cancelled: 'border border-border text-muted-foreground',
};

const COLOR_DOT: Record<string, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent-foreground',
};

interface RequestRowProps {
  request: LeaveRequest;
  /** Show who the request belongs to (lists of other people). */
  showEmployee?: boolean;
  /** Offer approve/reject. */
  decide?: boolean;
  /** Offer cancel (own requests, or an approver cancelling one of their people). */
  cancel?: boolean;
}

/** One leave request: dates, type, status and the actions the server says the caller may take. */
export function RequestRow({ request, showEmployee, decide, cancel }: RequestRowProps) {
  const { t, i18n } = useTranslation('leave');
  const language = i18n.resolvedLanguage ?? 'en';
  const typeName = useTypeName();
  const errors = useLeaveErrors();
  const approve = useDecideRequest('approve');
  const reject = useDecideRequest('reject');
  const cancelRequest = useDecideRequest('cancel');
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);

  const from = formatDay(request.startDate, language);
  const to = formatDay(request.endDate, language);
  const error = approve.error ?? reject.error ?? cancelRequest.error;
  const pending = approve.isPending || reject.isPending || cancelRequest.isPending;
  const name = `${request.employee.firstName} ${request.employee.lastName}`;

  return (
    <li className="space-y-2 rounded-xl glass p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showEmployee && <p className="font-medium">{name}</p>}
          <p className={cn('text-sm', showEmployee ? 'text-muted-foreground' : 'font-medium')}>
            {request.startDate === request.endDate ? from : t('range', { from, to })}
          </p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {request.leaveType ? (
              <>
                <span
                  className={cn(
                    'inline-block size-2.5 rounded-full',
                    COLOR_DOT[request.leaveType.color],
                  )}
                  aria-hidden="true"
                />
                {typeName(request.leaveType)}
              </>
            ) : (
              t('absent')
            )}
            {' · '}
            {t('days', {
              count: request.days,
              formattedCount: formatNumber(request.days, language),
            })}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            STATUS_STYLE[request.status],
          )}
        >
          {t(`status.${request.status}`)}
        </span>
      </div>

      {request.reason && (
        <p className="text-sm text-muted-foreground">
          {t('requests.reason', { text: request.reason })}
        </p>
      )}
      {request.decisionComment && (
        <p className="text-sm text-muted-foreground">
          {t('requests.comment', { text: request.decisionComment })}
        </p>
      )}
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {decide && request.canApprove && <ConflictsPanel requestId={request.id} name={name} />}

      {(decide && request.canApprove) || (cancel && request.canCancel) ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {decide && request.canApprove && (
              <>
                <Button
                  variant="secondary"
                  aria-pressed={mode === 'approve'}
                  onClick={() => setMode(mode === 'approve' ? null : 'approve')}
                >
                  {t('approvals.approve')}
                </Button>
                <Button
                  variant="secondary"
                  aria-pressed={mode === 'reject'}
                  onClick={() => setMode(mode === 'reject' ? null : 'reject')}
                >
                  {t('approvals.reject')}
                </Button>
              </>
            )}
            {cancel && request.canCancel && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => cancelRequest.mutate({ request })}
              >
                {cancelRequest.isPending ? t('requests.cancelling') : t('requests.cancel')}
              </Button>
            )}
          </div>
          {mode && (
            <div
              className="space-y-2"
              role="group"
              aria-label={`${name}: ${t(`approvals.${mode}`)}`}
            >
              <label className="block text-sm font-medium" htmlFor={`comment-${request.id}`}>
                {t('approvals.comment')}
              </label>
              <textarea
                id={`comment-${request.id}`}
                rows={2}
                maxLength={300}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="min-h-11 w-full rounded-md glass px-3 py-2 text-base text-foreground md:text-sm"
              />
              <div className="flex gap-2">
                <Button
                  variant={mode === 'reject' ? 'danger' : 'primary'}
                  disabled={pending}
                  onClick={() =>
                    (mode === 'approve' ? approve : reject).mutate(
                      { request, comment: comment.trim() || undefined },
                      { onSuccess: () => setMode(null) },
                    )
                  }
                >
                  {pending
                    ? t('approvals.working')
                    : mode === 'approve'
                      ? t('approvals.confirmApprove')
                      : t('approvals.confirmReject')}
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  {t('approvals.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
