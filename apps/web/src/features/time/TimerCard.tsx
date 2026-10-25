import { zodResolver } from '@hookform/resolvers/zod';
import type { TimeEntry } from '@intime/contracts';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { timerFormSchema, toStartTimer, type TimerFormValues } from './forms';
import { useStartTimer, useStopTimer, useTimer } from './hooks';
import { TargetFields } from './targets';
import { useTimeErrors } from './use-time-errors';

/** H:MM:SS since the timer started; ticks every second while shown. */
function Elapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return (
    <time className="text-3xl font-semibold tabular-nums" dateTime={`PT${h}H${m}M${s}S`}>
      {h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </time>
  );
}

export function TimerCard() {
  const { t } = useTranslation('time');
  const errors = useTimeErrors();
  const query = useTimer();
  const stop = useStopTimer();
  const timer = query.data?.timer ?? null;

  return (
    <Card className="space-y-3">
      <CardTitle>{t('timer.title')}</CardTitle>
      {query.isError && <Alert tone="danger">{errors.apiError(query.error)}</Alert>}
      {timer ? (
        <div className="space-y-3">
          <Running timer={timer} />
          {stop.isError && <Alert tone="danger">{errors.apiError(stop.error)}</Alert>}
          <Button disabled={stop.isPending} onClick={() => stop.mutate()}>
            {t('timer.stop')}
          </Button>
        </div>
      ) : (
        query.data && <StartForm />
      )}
    </Card>
  );
}

function Running({ timer }: { timer: TimeEntry }) {
  const { t } = useTranslation('time');
  return (
    <div className="space-y-1" role="status">
      <p className="text-sm text-muted-foreground">
        {t('timer.runningOn', {
          project: `${timer.project.code} · ${timer.project.name}`,
        })}
        {timer.task && ` · ${timer.task.key}`}
      </p>
      {timer.startedAt && <Elapsed startedAt={timer.startedAt} />}
      {timer.note && <p className="text-sm">{timer.note}</p>}
    </div>
  );
}

function StartForm() {
  const { t } = useTranslation('time');
  const messages = useMessages();
  const errors = useTimeErrors();
  const start = useStartTimer();
  const form = useForm<TimerFormValues>({
    resolver: zodResolver(timerFormSchema),
    defaultValues: { projectId: '', taskId: '', note: '' },
  });
  const fieldErrors = form.formState.errors;

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={t('timer.startTitle')}
      onSubmit={form.handleSubmit((v) =>
        start.mutate(toStartTimer(v), { onSuccess: () => form.reset() }),
      )}
    >
      <Controller
        control={form.control}
        name="projectId"
        render={({ field: project }) => (
          <Controller
            control={form.control}
            name="taskId"
            render={({ field: task }) => (
              <TargetFields
                projectId={project.value}
                taskId={task.value}
                onProject={project.onChange}
                onTask={task.onChange}
                projectError={messages.validation(fieldErrors.projectId)}
              />
            )}
          />
        )}
      />
      <div className="sm:col-span-2">
        <Field label={t('form.note')} error={messages.validation(fieldErrors.note)}>
          {(field) => (
            <Input {...field} maxLength={500} autoComplete="off" {...form.register('note')} />
          )}
        </Field>
      </div>
      {start.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(start.error)}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={start.isPending}>
          {t('timer.start')}
        </Button>
      </div>
    </form>
  );
}
