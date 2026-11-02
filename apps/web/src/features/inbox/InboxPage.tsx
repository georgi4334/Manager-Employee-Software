import { daysBetween, formatDuration, todayIn } from '@intime/contracts';
import {
  CalendarCheck,
  CalendarOff,
  Check,
  ClipboardCheck,
  Inbox,
  MessageSquareWarning,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useMessages } from '@/features/auth/messages';
import { useRespond } from '@/features/calendar/hooks';
import { useDecideRequest } from '@/features/leave/hooks';
import { useTypeName } from '@/features/leave/names';
import { useDecideTimesheet } from '@/features/time/hooks';
import { cn } from '@/shared/lib/cn';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { SkeletonCard, SkeletonGroup } from '@/shared/ui/skeleton';
import { TabList } from '@/shared/ui/tabs';
import { initials } from '@/shared/ui/tiles';
import { countByKind, INBOX_KINDS, useInbox, type InboxItem, type InboxKind } from './use-inbox';

const GROUP: Record<InboxKind, { icon: LucideIcon; to: string }> = {
  leave: { icon: CalendarOff, to: '/leave?tab=approvals' },
  timesheet: { icon: Timer, to: '/time?tab=approvals' },
  review: { icon: ClipboardCheck, to: '/reviews' },
  feedback: { icon: MessageSquareWarning, to: '/feedback?box=reported' },
  invitation: { icon: CalendarCheck, to: '/calendar?view=agenda' },
};

type Filter = 'all' | InboxKind;
type Selectable = Extract<InboxItem, { kind: 'leave' | 'timesheet' }>;

const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

function useToday() {
  const { data: user } = useCurrentUser();
  return todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** "Waiting for me" (docs/adr/0038-waiting-for-me.md): everything that needs the user's decision, in one place. */
export function InboxPage() {
  const { t } = useTranslation('inbox');
  const messages = useMessages();
  const inbox = useInbox();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [said, setSaid] = useState('');
  const counts = countByKind(inbox.items);
  const shown = inbox.items.filter((i) => filter === 'all' || i.kind === filter);
  const selectable = inbox.items.filter(
    (i): i is Selectable => (i.kind === 'leave' || i.kind === 'timesheet') && selected.has(i.key),
  );

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-28">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>

      <TabList
        mode="toggle"
        label={t('filter.label')}
        tabs={(['all', ...INBOX_KINDS] as const).map((name) => ({
          name,
          label: t('filter.option', {
            name: t(`filter.${name}`),
            count: name === 'all' ? inbox.items.length : counts[name],
          }),
        }))}
        value={filter}
        onChange={(name) => setFilter(name as Filter)}
      />

      {inbox.error && (
        <Alert tone="danger">
          {messages.apiError(inbox.error)}{' '}
          <button type="button" className="font-semibold underline" onClick={inbox.refetch}>
            {t('retry')}
          </button>
        </Alert>
      )}

      {inbox.isPending && inbox.items.length === 0 ? (
        <SkeletonGroup label={t('loading')} className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{filter === 'all' ? t('empty') : t('emptyFilter')}</p>
        </Card>
      ) : (
        INBOX_KINDS.filter((kind) => shown.some((i) => i.kind === kind)).map((kind) => (
          <Group key={kind} kind={kind} count={counts[kind]}>
            {shown
              .filter((i) => i.kind === kind)
              .map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  selected={selected.has(item.key)}
                  onToggle={() => toggle(item.key)}
                  onDone={(text) => {
                    setSaid(text);
                    setSelected((s) => {
                      const next = new Set(s);
                      next.delete(item.key);
                      return next;
                    });
                  }}
                />
              ))}
          </Group>
        ))
      )}

      {selectable.length > 0 && (
        <BulkBar
          items={selectable}
          onClear={() => setSelected(new Set())}
          onDone={(text) => {
            setSaid(text);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function Group({ kind, count, children }: { kind: InboxKind; count: number; children: ReactNode }) {
  const { t } = useTranslation('inbox');
  const { icon: Icon, to } = GROUP[kind];
  const id = `inbox-${kind}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 id={id} className="text-base font-semibold">
          {t(`group.${kind}`)} <span className="font-normal text-muted-foreground">{count}</span>
        </h2>
        <Link to={to} className="ml-auto text-sm font-medium text-primary hover:underline">
          {t(`open.${kind}`)}
        </Link>
      </div>
      <ul aria-labelledby={id} className="divide-y divide-border rounded-xl glass">
        {children}
      </ul>
    </section>
  );
}

function Age({ since, late }: { since: string; late?: boolean }) {
  const { t } = useTranslation('inbox');
  const days = Math.max(0, daysBetween(since.slice(0, 10), useToday()));
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
        late ? 'border-danger text-danger' : 'border-border text-muted-foreground',
      )}
    >
      {late ? t('late') : days === 0 ? t('age.today') : t('age.days', { count: days })}
    </span>
  );
}

function Row({
  item,
  selected,
  onToggle,
  onDone,
}: {
  item: InboxItem;
  selected: boolean;
  onToggle: () => void;
  onDone: (text: string) => void;
}) {
  switch (item.kind) {
    case 'leave':
      return <LeaveRow item={item} selected={selected} onToggle={onToggle} onDone={onDone} />;
    case 'timesheet':
      return <SheetRow item={item} selected={selected} onToggle={onToggle} onDone={onDone} />;
    case 'review':
      return <ReviewRow item={item} />;
    case 'feedback':
      return <FeedbackRow item={item} />;
    case 'invitation':
      return <InvitationRow item={item} onDone={onDone} />;
  }
}

function Shell({
  who,
  select,
  title,
  meta,
  age,
  actions,
  error,
}: {
  who: string;
  select?: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  age: ReactNode;
  actions: ReactNode;
  error?: ReactNode;
}) {
  return (
    <li className="space-y-2 p-3.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {select}
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
        >
          {who}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-snug">{title}</p>
          <p className="break-words text-sm text-muted-foreground">{meta}</p>
        </div>
        {age}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      </div>
      {error}
    </li>
  );
}

function SelectBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="size-5 cursor-pointer accent-[var(--primary)]"
      />
    </label>
  );
}

function LeaveRow({
  item,
  selected,
  onToggle,
  onDone,
}: {
  item: Extract<InboxItem, { kind: 'leave' }>;
  selected: boolean;
  onToggle: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation('inbox');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const typeName = useTypeName();
  const approve = useDecideRequest('approve');
  const reject = useDecideRequest('reject');
  const { request } = item;
  const name = nameOf(request.employee);
  const range =
    request.startDate === request.endDate
      ? formatDay(request.startDate, language, { weekday: 'short', day: 'numeric', month: 'short' })
      : t('range', {
          from: formatDay(request.startDate, language, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
          to: formatDay(request.endDate, language, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
        });
  const busy = approve.isPending || reject.isPending;
  const error = approve.error ?? reject.error;
  return (
    <Shell
      who={initials(request.employee.firstName, request.employee.lastName)}
      select={<SelectBox label={t('select', { name })} checked={selected} onChange={onToggle} />}
      title={t('leave.title', {
        name,
        type:
          request.leaveType && !request.masked ? typeName(request.leaveType) : t('leave.absent'),
      })}
      meta={t('leave.meta', {
        range,
        days: formatNumber(request.days, language),
        count: request.days,
      })}
      age={<Age since={request.createdAt} />}
      actions={
        <>
          <Button
            disabled={busy}
            aria-label={t('leave.approve', { name })}
            onClick={() =>
              approve.mutate({ request }, { onSuccess: () => onDone(t('done.approved', { name })) })
            }
          >
            <Check className="size-4" aria-hidden="true" />
            {t('approve')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label={t('leave.reject', { name })}
            onClick={() =>
              reject.mutate({ request }, { onSuccess: () => onDone(t('done.rejected', { name })) })
            }
          >
            {t('reject')}
          </Button>
        </>
      }
      error={error && <Alert tone="danger">{messages.apiError(error)}</Alert>}
    />
  );
}

function SheetRow({
  item,
  selected,
  onToggle,
  onDone,
}: {
  item: Extract<InboxItem, { kind: 'timesheet' }>;
  selected: boolean;
  onToggle: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation('inbox');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const decide = useDecideTimesheet();
  const { sheet } = item;
  const name = nameOf(sheet.employee);
  return (
    <Shell
      who={initials(sheet.employee.firstName, sheet.employee.lastName)}
      select={<SelectBox label={t('select', { name })} checked={selected} onChange={onToggle} />}
      title={t('timesheet.title', {
        name,
        week: formatDay(sheet.weekStart, language, { day: 'numeric', month: 'short' }),
      })}
      meta={t('timesheet.meta', { hours: formatDuration(sheet.totalMinutes) })}
      age={<Age since={sheet.submittedAt} />}
      actions={
        <>
          <Button
            disabled={decide.isPending}
            aria-label={t('timesheet.approve', { name })}
            onClick={() =>
              decide.mutate(
                { id: sheet.id, action: 'approve' },
                { onSuccess: () => onDone(t('done.approved', { name })) },
              )
            }
          >
            <Check className="size-4" aria-hidden="true" />
            {t('approve')}
          </Button>
          <Button
            variant="secondary"
            disabled={decide.isPending}
            aria-label={t('timesheet.reject', { name })}
            onClick={() =>
              decide.mutate(
                { id: sheet.id, action: 'reject' },
                { onSuccess: () => onDone(t('done.rejected', { name })) },
              )
            }
          >
            {t('reject')}
          </Button>
        </>
      }
      error={decide.error && <Alert tone="danger">{messages.apiError(decide.error)}</Alert>}
    />
  );
}

function ReviewRow({ item }: { item: Extract<InboxItem, { kind: 'review' }> }) {
  const { t } = useTranslation('inbox');
  const { review, part, late } = item;
  const name = nameOf(review.employee);
  return (
    <Shell
      who={initials(review.employee.firstName, review.employee.lastName)}
      title={part === 'self' ? t('review.self') : t('review.manager', { name })}
      meta={review.cycle.name}
      age={late ? <Age since="" late /> : null}
      actions={
        <Button asChild>
          <Link
            to={`/reviews/${review.id}`}
            aria-label={part === 'self' ? t('review.writeSelf') : t('review.writeFor', { name })}
          >
            {t('review.write')}
          </Link>
        </Button>
      }
    />
  );
}

function FeedbackRow({ item }: { item: Extract<InboxItem, { kind: 'feedback' }> }) {
  const { t, i18n } = useTranslation('inbox');
  const language = i18n.resolvedLanguage ?? 'en';
  return (
    <Shell
      who="!"
      title={t('feedback.title')}
      meta={t('feedback.meta', { date: formatDay(item.item.createdAt.slice(0, 10), language) })}
      age={<Age since={item.item.createdAt} />}
      actions={
        <Button asChild variant="secondary">
          <Link to="/feedback?box=reported">{t('feedback.open')}</Link>
        </Button>
      }
    />
  );
}

function InvitationRow({
  item,
  onDone,
}: {
  item: Extract<InboxItem, { kind: 'invitation' }>;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation('inbox');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const { event } = item;
  const respond = useRespond(event.id);
  const date = formatDay(event.occurrenceDate, language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const when =
    event.allDay || !event.startTime
      ? date
      : t('invitation.time', { date, from: event.startTime, to: event.endTime ?? '' });
  const answer = (response: 'accepted' | 'tentative' | 'declined') =>
    respond.mutate(response, { onSuccess: () => onDone(t('done.answered')) });
  return (
    <Shell
      who={initials(event.owner.firstName, event.owner.lastName)}
      title={t('invitation.title', { title: event.title, name: nameOf(event.owner) })}
      meta={when}
      age={null}
      actions={
        <>
          <Button
            disabled={respond.isPending}
            aria-label={t('invitation.acceptOf', { title: event.title })}
            onClick={() => answer('accepted')}
          >
            {t('invitation.accept')}
          </Button>
          <Button
            variant="secondary"
            disabled={respond.isPending}
            aria-label={t('invitation.maybeOf', { title: event.title })}
            onClick={() => answer('tentative')}
          >
            {t('invitation.maybe')}
          </Button>
          <Button
            variant="secondary"
            disabled={respond.isPending}
            aria-label={t('invitation.declineOf', { title: event.title })}
            onClick={() => answer('declined')}
          >
            {t('invitation.decline')}
          </Button>
        </>
      }
      error={respond.error && <Alert tone="danger">{messages.apiError(respond.error)}</Alert>}
    />
  );
}

/** Runs the same single decisions one after another for the selected leave requests and weeks. */
function BulkBar({
  items,
  onClear,
  onDone,
}: {
  items: Selectable[];
  onClear: () => void;
  onDone: (text: string) => void;
}) {
  const { t } = useTranslation('inbox');
  const messages = useMessages();
  const approveLeave = useDecideRequest('approve');
  const rejectLeave = useDecideRequest('reject');
  const decideSheet = useDecideTimesheet();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<{ count: number; error: unknown } | null>(null);

  const run = async (action: 'approve' | 'reject') => {
    setRunning(true);
    setFailure(null);
    let ok = 0;
    let failed = 0;
    let first: unknown = null;
    for (const item of items) {
      try {
        if (item.kind === 'leave')
          await (action === 'approve' ? approveLeave : rejectLeave).mutateAsync({
            request: item.request,
          });
        else await decideSheet.mutateAsync({ id: item.sheet.id, action });
        ok += 1;
      } catch (error) {
        failed += 1;
        first ??= error;
      }
    }
    setRunning(false);
    setConfirming(false);
    if (failed > 0) setFailure({ count: failed, error: first });
    onDone(t(action === 'approve' ? 'bulk.approved' : 'bulk.rejected', { count: ok }));
  };

  return (
    <div
      role="region"
      aria-label={t('bulk.label')}
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-2xl space-y-2 rounded-2xl bg-sidebar p-3 text-sidebar-foreground shadow-card md:bottom-6 md:left-[calc(16rem+1.5rem)] md:right-6"
    >
      {failure && (
        <Alert tone="danger">
          {t('bulk.failed', { count: failure.count })} {messages.apiError(failure.error)}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto px-1 font-semibold">
          {t('bulk.selected', { count: items.length })}
        </span>
        {confirming ? (
          <>
            <span className="text-sm">{t('bulk.confirmReject', { count: items.length })}</span>
            <Button variant="danger" disabled={running} onClick={() => void run('reject')}>
              {t('bulk.confirm')}
            </Button>
            <Button
              variant="ghost"
              className="text-sidebar-foreground"
              onClick={() => setConfirming(false)}
            >
              {t('bulk.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button disabled={running} onClick={() => void run('approve')}>
              <Check className="size-4" aria-hidden="true" />
              {t('bulk.approve', { count: items.length })}
            </Button>
            <Button variant="secondary" disabled={running} onClick={() => setConfirming(true)}>
              {t('bulk.reject', { count: items.length })}
            </Button>
            <Button variant="ghost" className="text-sidebar-foreground" onClick={onClear}>
              {t('bulk.clear')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
