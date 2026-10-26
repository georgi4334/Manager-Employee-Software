import type { AiStatus } from '@intime/contracts';
import { AI_LIMITS } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Textarea } from '@/shared/ui/textarea';
import { formatDate } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useConversation, useConversations, useDeleteConversation, useSend } from './hooks';

interface Props {
  status: AiStatus;
  onOpenSettings: () => void;
}

/** Why the assistant cannot answer yet, in the order the person can fix it. */
function notReady(status: AiStatus): 'disabled' | 'consent' | 'key' | null {
  if (!status.enabled) return 'disabled';
  if (!status.consent.accepted) return 'consent';
  if (!status.keySource) return 'key';
  return null;
}

export function ChatTab({ status, onOpenSettings }: Props) {
  const { t, i18n } = useTranslation('assistant');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const reason = notReady(status);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const conversations = useConversations(reason === null || status.enabled);
  const current = useConversation(conversationId);
  const send = useSend();
  const remove = useDeleteConversation();

  if (reason) {
    return (
      <Card className="space-y-3">
        <Alert tone="info">{t(`notReady.${reason}`)}</Alert>
        {reason !== 'disabled' && (
          <Button onClick={onOpenSettings}>{t('notReady.openSettings')}</Button>
        )}
      </Card>
    );
  }

  const submit = () => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setPending(message);
    setText('');
    send.mutate(
      { message, conversationId },
      {
        onSuccess: (reply) => {
          setConversationId(reply.conversationId);
          setPending(null);
        },
        onError: () => {
          setPending(null);
          setText(message);
        },
      },
    );
  };
  const shown = current.data?.messages ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setConversationId(null);
            setPending(null);
          }}
        >
          {t('chat.new')}
        </Button>
        {conversationId && (
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(conversationId, { onSuccess: () => setConversationId(null) })
            }
          >
            {t('chat.delete')}
          </Button>
        )}
      </div>

      <Card className="space-y-3">
        <div role="log" aria-label={t('chat.log')} aria-live="polite" className="space-y-3">
          {shown.length === 0 && !pending && (
            <p className="text-sm text-muted-foreground">{t('chat.empty')}</p>
          )}
          {shown.map((m) => (
            <div
              key={m.id}
              className={cn(
                'max-w-[90%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm',
                m.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-secondary',
              )}
            >
              <p className="sr-only">{t(`chat.from.${m.role}`)}</p>
              {m.content}
              {m.toolsUsed.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('chat.used', {
                    tools: m.toolsUsed.map((x) => t(`tools.${x as 'who_is_off'}`)).join(', '),
                  })}
                </p>
              )}
            </div>
          ))}
          {pending && (
            <>
              <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                {pending}
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {t('chat.thinking')}
              </p>
            </>
          )}
        </div>
        {send.isError && <Alert tone="danger">{messages.apiError(send.error)}</Alert>}
        <form
          noValidate
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="assistant-message" className="text-sm font-medium">
            {t('chat.message')}
          </label>
          <Textarea
            id="assistant-message"
            rows={3}
            maxLength={AI_LIMITS.maxMessageLength}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('chat.placeholder')}
          />
          <Button type="submit" disabled={send.isPending || text.trim() === ''}>
            {t('chat.send')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t('chat.privacy')}</p>
      </Card>

      {(conversations.data?.items.length ?? 0) > 0 && (
        <section aria-labelledby="assistant-history" className="space-y-2">
          <h2 id="assistant-history" className="text-base font-semibold">
            {t('chat.history')}
          </h2>
          <ul className="space-y-2">
            {conversations.data?.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === conversationId ? 'true' : undefined}
                  onClick={() => setConversationId(c.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 text-left text-sm"
                >
                  <span className="min-w-0 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(c.updatedAt, language)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
