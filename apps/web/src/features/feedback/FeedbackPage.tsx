import { FEEDBACK_BOXES, type FeedbackBox } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { useChart } from '@/features/organization/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Select } from '@/shared/ui/select';
import { PAGE_SIZE } from './api';
import { FeedbackCard } from './FeedbackCard';
import { GiveForm } from './GiveForm';
import { useFeedback } from './hooks';
import { useFeedbackErrors } from './use-feedback-errors';
import { TabList } from '@/shared/ui/tabs';

export function FeedbackPage() {
  const { t } = useTranslation('feedback');
  const errors = useFeedbackErrors();
  const [params, setParams] = useSearchParams();
  const canGive = usePermission('feedback.give');
  const canReceive = usePermission('feedback.view_received');
  const canModerate = usePermission('feedback.moderate');
  const me = useCurrentUser();
  // Managers (reports) and HR (all) can also read what was shared with a person's manager.
  const receivedScope = me.data?.permissions['feedback.view_received'];
  const canReadOthers = receivedScope === 'reports' || receivedScope === 'all';
  const chart = useChart();
  const [creating, setCreating] = useState(false);
  const [sent, setSent] = useState(false);
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState('');

  const boxes = FEEDBACK_BOXES.filter((b) =>
    b === 'received' ? canReceive : b === 'given' ? canGive : canModerate,
  );
  const requested = FEEDBACK_BOXES.find((b) => b === params.get('box'));
  const box: FeedbackBox =
    requested && boxes.includes(requested) ? requested : (boxes[0] ?? 'received');

  const query = useFeedback({ box, employeeId, page }, boxes.length > 0);
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {canGive && !creating && (
        <Button
          onClick={() => {
            setCreating(true);
            setSent(false);
          }}
        >
          {t('new')}
        </Button>
      )}
      {sent && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('sent')}
        </p>
      )}
      {creating && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('form.title')}</h2>
          <GiveForm
            onDone={(ok) => {
              setCreating(false);
              setSent(ok);
            }}
          />
        </Card>
      )}

      {boxes.length > 1 && (
        <TabList
          mode="toggle"
          label={t('tabs.label')}
          tabs={boxes.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={box}
          onChange={(name) => {
            const next = new URLSearchParams(params);
            next.set('box', name);
            setParams(next, { replace: true });
            setPage(1);
          }}
        />
      )}

      {box === 'received' && canReadOthers && (
        <Select
          aria-label={t('whose')}
          value={employeeId}
          onChange={(ev) => {
            setEmployeeId(ev.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('mine')}</option>
          {(chart.data?.nodes ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {t('sharedWith', { name: `${p.firstName} ${p.lastName}` })}
            </option>
          ))}
        </Select>
      )}

      {query.isPending && boxes.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data &&
        (data.items.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t(`empty.${box}`)}</p>
          </Card>
        ) : (
          <>
            <ul className="space-y-2" aria-label={t(`tabs.${box}`)}>
              {data.items.map((item) => (
                <FeedbackCard key={item.id} item={item} />
              ))}
            </ul>
            {pages > 1 && (
              <nav className="flex items-center justify-between gap-2" aria-label={t('pagination')}>
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t('previous')}
                </Button>
                <span className="text-sm text-muted-foreground">{t('page', { page, pages })}</span>
                <Button
                  variant="secondary"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {t('next')}
                </Button>
              </nav>
            )}
          </>
        ))}
    </div>
  );
}
