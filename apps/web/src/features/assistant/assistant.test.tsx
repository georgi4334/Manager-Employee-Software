import type { AiConversation, AiStatus } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import {
  API,
  errorResponse,
  server,
  signedInHandlers,
  userWithPermissions,
  userWithRole,
} from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-26T09:00:00.000Z';

const status = (o: Partial<AiStatus> = {}): AiStatus => ({
  enabled: true,
  retentionDays: 90,
  canStoreKeys: true,
  consent: { accepted: true, sharePeopleData: false },
  ownKey: { provider: 'groq', model: 'llama-3.3-70b-versatile', last4: '7890' },
  workspaceKey: null,
  keySource: 'user',
  tools: ['get_my_leave_balance', 'get_my_open_tasks', 'get_my_goals'],
  ...o,
});

interface Backend {
  status: AiStatus;
  calls: { method: string; path: string; body: unknown }[];
  conversations: AiConversation[];
  reply: string;
  chatError: boolean;
  toolsUsed: string[];
}

function serve(initial: Partial<AiStatus> = {}, extra: Partial<Backend> = {}): Backend {
  const backend: Backend = {
    status: status(initial),
    calls: [],
    conversations: [],
    reply: 'You have 20 days left.',
    chatError: false,
    toolsUsed: [],
    ...extra,
  };
  const record = async (request: Request, path: string) => {
    const body =
      request.method === 'GET' || request.method === 'DELETE'
        ? null
        : await request.json().catch(() => null);
    backend.calls.push({ method: request.method, path, body });
    return body as Record<string, unknown> | null;
  };
  server.use(
    http.get(`${API}/ai/status`, () => HttpResponse.json(backend.status)),
    http.put(`${API}/ai/consent`, async ({ request }) => {
      const body = await record(request, '/ai/consent');
      backend.status = {
        ...backend.status,
        consent: { accepted: true, sharePeopleData: Boolean(body?.sharePeopleData) },
      };
      return HttpResponse.json(backend.status);
    }),
    http.put(`${API}/ai/key/:scope`, async ({ request, params }) => {
      const body = await record(request, `/ai/key/${String(params.scope)}`);
      const summary = {
        provider: body?.provider as 'groq',
        model: String(body?.model),
        last4: String(body?.apiKey).slice(-4),
      };
      backend.status =
        params.scope === 'me'
          ? { ...backend.status, ownKey: summary, keySource: 'user' }
          : { ...backend.status, workspaceKey: summary };
      return HttpResponse.json(backend.status);
    }),
    http.delete(`${API}/ai/key/:scope`, async ({ request, params }) => {
      await record(request, `/ai/key/${String(params.scope)}`);
      backend.status =
        params.scope === 'me'
          ? { ...backend.status, ownKey: null, keySource: null }
          : { ...backend.status, workspaceKey: null };
      return HttpResponse.json(backend.status);
    }),
    http.post(`${API}/ai/key/:scope/test`, async ({ request, params }) => {
      await record(request, `/ai/key/${String(params.scope)}/test`);
      return HttpResponse.json({ ok: true });
    }),
    http.put(`${API}/ai/workspace`, async ({ request }) => {
      const body = await record(request, '/ai/workspace');
      backend.status = {
        ...backend.status,
        enabled: typeof body?.enabled === 'boolean' ? body.enabled : backend.status.enabled,
        retentionDays:
          typeof body?.retentionDays === 'number'
            ? body.retentionDays
            : backend.status.retentionDays,
      };
      return HttpResponse.json(backend.status);
    }),
    http.post(`${API}/ai/chat`, async ({ request }) => {
      const body = await record(request, '/ai/chat');
      if (backend.chatError) return errorResponse('AI_PROVIDER_ERROR', 502);
      const id = (body?.conversationId as string | undefined) ?? uuid(500);
      const existing = backend.conversations.find((c) => c.id === id);
      const user = {
        id: uuid(600 + backend.calls.length),
        role: 'user' as const,
        content: String(body?.message),
        toolsUsed: [],
        createdAt: NOW,
      };
      const assistant = {
        id: uuid(700 + backend.calls.length),
        role: 'assistant' as const,
        content: backend.reply,
        toolsUsed: backend.toolsUsed,
        createdAt: NOW,
      };
      if (existing) existing.messages.push(user, assistant);
      else
        backend.conversations.unshift({
          id,
          title: String(body?.message),
          updatedAt: NOW,
          messages: [user, assistant],
        });
      return HttpResponse.json({ conversationId: id, message: assistant });
    }),
    http.get(`${API}/ai/conversations`, () =>
      HttpResponse.json({
        items: backend.conversations.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      }),
    ),
    http.get(`${API}/ai/conversations/:id`, ({ params }) => {
      const found = backend.conversations.find((c) => c.id === params.id);
      return found ? HttpResponse.json(found) : errorResponse('NOT_FOUND', 404);
    }),
    http.delete(`${API}/ai/conversations/:id`, async ({ request, params }) => {
      await record(request, `/ai/conversations/${String(params.id)}`);
      backend.conversations = backend.conversations.filter((c) => c.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return backend;
}

const asEmployee = () => server.use(...signedInHandlers(userWithRole('employee')));
const asAdmin = () => server.use(...signedInHandlers(userWithRole('admin')));

beforeEach(() => asEmployee());

describe('access', () => {
  it('is for people with the assistant permission only', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    serve();
    await renderApp('/assistant');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/assistant');
    expect(await screen.findByRole('heading', { name: 'Assistent' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Ihre Frage')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/assistant');
    expect(await screen.findByRole('heading', { name: 'Асистент' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Вашият въпрос')).toBeInTheDocument();
  });
});

describe('before the assistant can answer', () => {
  it('says that the workspace has switched it off, without an offer to open settings', async () => {
    serve({ enabled: false });
    await renderApp('/assistant');
    expect(await screen.findByText(/switched off for your workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });

  it('asks for the notice to be accepted first, and leads to the settings', async () => {
    serve({ consent: { accepted: false, sharePeopleData: false } });
    await renderApp('/assistant');
    expect(await screen.findByText(/read and accept the notice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('heading', { name: 'Notice and consent' })).toBeInTheDocument();
  });

  it('asks for a key when there is none', async () => {
    serve({ ownKey: null, keySource: null });
    await renderApp('/assistant');
    expect(await screen.findByText(/needs an AI provider key/)).toBeInTheDocument();
  });
});

describe('the chat', () => {
  it('sends a question, shows the answer and what was looked up, and continues the conversation', async () => {
    const backend = serve({}, { toolsUsed: ['get_my_leave_balance'] });
    await renderApp('/assistant');
    await userEvent.type(await screen.findByLabelText('Your question'), 'How many days are left?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = await screen.findByRole('log', { name: 'Conversation' });
    expect(await within(log).findByText('You have 20 days left.')).toBeInTheDocument();
    expect(within(log).getByText('How many days are left?')).toBeInTheDocument();
    expect(within(log).getByText('Looked up: your leave balance')).toBeInTheDocument();
    expect(backend.calls.find((c) => c.path === '/ai/chat')?.body).toEqual({
      message: 'How many days are left?',
    });

    backend.reply = 'And 3 pending.';
    await userEvent.type(screen.getByLabelText('Your question'), 'And pending?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await within(log).findByText('And 3 pending.')).toBeInTheDocument();
    expect(backend.calls.filter((c) => c.path === '/ai/chat')[1]?.body).toEqual({
      message: 'And pending?',
      conversationId: uuid(500),
    });
  });

  it('does not send an empty question', async () => {
    const backend = serve();
    await renderApp('/assistant');
    expect(await screen.findByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your question'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(backend.calls.some((c) => c.path === '/ai/chat')).toBe(false);
  });

  it('shows the error and gives the question back to edit', async () => {
    serve({}, { chatError: true });
    await renderApp('/assistant');
    const box = await screen.findByLabelText('Your question');
    await userEvent.type(box, 'Will fail');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/AI provider could not answer/)).toBeInTheDocument();
    expect(box).toHaveValue('Will fail');
  });

  it('shows the answer as plain text, never as HTML', async () => {
    serve({}, { reply: '<img src=x onerror=alert(1)> **bold**' });
    await renderApp('/assistant');
    await userEvent.type(await screen.findByLabelText('Your question'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = await screen.findByRole('log', { name: 'Conversation' });
    expect(
      await within(log).findByText('<img src=x onerror=alert(1)> **bold**'),
    ).toBeInTheDocument();
    expect(log.querySelector('img')).toBeNull();
  });

  it('lists earlier conversations, opens one, starts a new one and deletes', async () => {
    const earlier: AiConversation = {
      id: uuid(400),
      title: 'Old question',
      updatedAt: NOW,
      messages: [
        { id: uuid(401), role: 'user', content: 'Old question', toolsUsed: [], createdAt: NOW },
        { id: uuid(402), role: 'assistant', content: 'Old answer', toolsUsed: [], createdAt: NOW },
      ],
    };
    const backend = serve({}, { conversations: [earlier] });
    await renderApp('/assistant');
    await userEvent.click(await screen.findByRole('button', { name: /Old question/ }));
    expect(await screen.findByText('Old answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Old question/ }));
    await screen.findByText('Old answer');
    await userEvent.click(screen.getByRole('button', { name: 'Delete this conversation' }));
    await waitFor(() => expect(screen.queryByText('Old answer')).not.toBeInTheDocument());
    expect(
      backend.calls.some(
        (c) => c.method === 'DELETE' && c.path === `/ai/conversations/${uuid(400)}`,
      ),
    ).toBe(true);
  });
});

describe('settings: consent', () => {
  it('saves the acceptance with the choice about other people, off by default', async () => {
    const backend = serve({ consent: { accepted: false, sharePeopleData: false } });
    await renderApp('/assistant?tab=settings');
    const share = await screen.findByRole('checkbox', { name: /look up other people/ });
    expect(share).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Accept and save' }));
    expect(await screen.findByText('You accepted the notice.')).toBeInTheDocument();
    expect(backend.calls.find((c) => c.path === '/ai/consent')?.body).toEqual({
      accept: true,
      sharePeopleData: false,
    });

    await userEvent.click(share);
    await userEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await waitFor(() =>
      expect(backend.calls.filter((c) => c.path === '/ai/consent').at(-1)?.body).toEqual({
        accept: true,
        sharePeopleData: true,
      }),
    );
  });
});

describe('settings: own key', () => {
  it('shows only the end of a stored key and never the key', async () => {
    serve();
    await renderApp('/assistant?tab=settings');
    expect(await screen.findByText(/key ending in 7890/)).toBeInTheDocument();
    expect(screen.getByText(/Groq, model llama-3.3-70b-versatile/)).toBeInTheDocument();
  });

  it('checks the form before sending, then stores the key and clears the field', async () => {
    const backend = serve({ ownKey: null, keySource: null });
    await renderApp('/assistant?tab=settings');
    const form = await screen.findByRole('form', { name: 'Your key' });
    await userEvent.click(within(form).getByRole('button', { name: 'Store key' }));
    expect(await within(form).findAllByRole('alert')).not.toHaveLength(0);
    expect(backend.calls.some((c) => c.path === '/ai/key/me')).toBe(false);

    await userEvent.type(within(form).getByLabelText('Model'), 'llama-3.3-70b-versatile');
    await userEvent.type(within(form).getByLabelText('Key'), 'short');
    await userEvent.click(within(form).getByRole('button', { name: 'Store key' }));
    expect(await within(form).findByText(/at least 8 characters/)).toBeInTheDocument();

    await userEvent.clear(within(form).getByLabelText('Key'));
    await userEvent.type(within(form).getByLabelText('Key'), 'gsk_abcdefgh1234');
    await userEvent.click(within(form).getByRole('button', { name: 'Store key' }));
    expect(await screen.findByText(/key ending in 1234/)).toBeInTheDocument();
    expect(backend.calls.find((c) => c.path === '/ai/key/me')?.body).toEqual({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_abcdefgh1234',
    });
    expect(within(form).getByLabelText('Key')).toHaveValue('');
  });

  it('tests and removes the stored key', async () => {
    const backend = serve();
    await renderApp('/assistant?tab=settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Test key' }));
    expect(await screen.findByText('The key works.')).toBeInTheDocument();
    expect(backend.calls.some((c) => c.path === '/ai/key/me/test')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(await screen.findByText('No key stored.')).toBeInTheDocument();
  });

  it('warns and blocks storing when the server cannot protect keys', async () => {
    serve({ canStoreKeys: false, ownKey: null, keySource: null });
    await renderApp('/assistant?tab=settings');
    expect(await screen.findByText(/cannot store keys at the moment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Store key' })).toBeDisabled();
  });

  it('shows a failed test in words', async () => {
    serve();
    server.use(http.post(`${API}/ai/key/me/test`, () => errorResponse('AI_PROVIDER_ERROR', 502)));
    await renderApp('/assistant?tab=settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Test key' }));
    expect(await screen.findByText(/AI provider could not answer/)).toBeInTheDocument();
  });
});

describe('settings: workspace', () => {
  it('is for administrators only', async () => {
    serve();
    await renderApp('/assistant?tab=settings');
    await screen.findByText(/key ending in 7890/);
    expect(screen.queryByRole('heading', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Workspace key' })).not.toBeInTheDocument();
  });

  it('lets an administrator switch it on and set the retention', async () => {
    asAdmin();
    const backend = serve({ enabled: false });
    await renderApp('/assistant?tab=settings');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Switch the assistant on for this workspace' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Switch the assistant on for this workspace' }),
      ).toBeChecked(),
    );
    expect(backend.calls.find((c) => c.path === '/ai/workspace')?.body).toEqual({ enabled: true });

    const retention = screen.getByLabelText('Keep conversations for (days)');
    await userEvent.clear(retention);
    await userEvent.type(retention, '400');
    await userEvent.click(screen.getByRole('button', { name: 'Save retention' }));
    expect(await screen.findByText(/whole number of days from 1 to 365/)).toBeInTheDocument();
    await userEvent.clear(retention);
    await userEvent.type(retention, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save retention' }));
    await waitFor(() =>
      expect(backend.calls.filter((c) => c.path === '/ai/workspace').at(-1)?.body).toEqual({
        retentionDays: 30,
      }),
    );
  });

  it('lets an administrator store the workspace key', async () => {
    asAdmin();
    const backend = serve({ workspaceKey: null });
    await renderApp('/assistant?tab=settings');
    const form = await screen.findByRole('form', { name: 'Workspace key' });
    await userEvent.selectOptions(within(form).getByLabelText('Provider'), 'mistral');
    await userEvent.type(within(form).getByLabelText('Model'), 'mistral-small-latest');
    await userEvent.type(within(form).getByLabelText('Key'), 'mk_abcdefgh9999');
    await userEvent.click(within(form).getByRole('button', { name: 'Store key' }));
    await waitFor(() =>
      expect(backend.calls.find((c) => c.path === '/ai/key/workspace')?.body).toEqual({
        provider: 'mistral',
        model: 'mistral-small-latest',
        apiKey: 'mk_abcdefgh9999',
      }),
    );
  });
});
