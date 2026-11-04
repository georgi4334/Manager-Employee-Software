import type { WorkspaceSettings } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
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

const settings = (o: Partial<WorkspaceSettings> = {}): WorkspaceSettings => ({
  name: 'Acme GmbH',
  slug: 'acme',
  timeZone: 'Europe/Sofia',
  language: 'en',
  country: 'BG',
  canEdit: true,
  ...o,
});

/** Answers GET and PUT like the API and records what was sent. */
function serve(initial: WorkspaceSettings = settings()) {
  let state = initial;
  const sent: unknown[] = [];
  server.use(
    http.get(`${API}/settings/workspace`, () => HttpResponse.json(state)),
    http.put(`${API}/settings/workspace`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push(body);
      state = {
        ...state,
        ...(body.name !== undefined ? { name: body.name as string } : {}),
        ...(body.timeZone !== undefined ? { timeZone: body.timeZone as string } : {}),
        ...(body.language !== undefined
          ? { language: body.language as WorkspaceSettings['language'] }
          : {}),
        ...('country' in body ? { country: body.country as string | null } : {}),
      };
      return HttpResponse.json(state);
    }),
  );
  return sent;
}

const form = () => screen.findByRole('form', { name: 'Workspace settings' });

describe('workspace settings page', () => {
  it('shows the current settings with the slug read-only', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    await renderApp('/settings/workspace');
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeInTheDocument();
    const f = await form();
    expect(within(f).getByLabelText('Name')).toHaveValue('Acme GmbH');
    expect(within(f).getByLabelText(/Address name/)).toHaveValue('acme');
    expect(within(f).getByLabelText(/Address name/)).toBeDisabled();
    expect(within(f).getByLabelText(/Time zone/)).toHaveValue('Europe/Sofia');
    expect(within(f).getByLabelText(/Default language/)).toHaveValue('en');
    expect(within(f).getByLabelText(/Default country/)).toHaveValue('BG');
    const countries = within(within(f).getByLabelText(/Default country/)).getAllByRole('option');
    expect(countries.map((o) => o.textContent)).toEqual([
      'None',
      'Bulgaria',
      'Germany',
      'United Kingdom',
    ]);
  });

  it('saves only what changed and says so', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const sent = serve();
    await renderApp('/settings/workspace');
    const user = userEvent.setup();
    const f = await form();
    await user.clear(within(f).getByLabelText('Name'));
    await user.type(within(f).getByLabelText('Name'), 'Acme Europe');
    await user.selectOptions(within(f).getByLabelText(/Time zone/), 'Europe/Berlin');
    await user.selectOptions(within(f).getByLabelText(/Default country/), '');
    await user.click(within(f).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved. The changes apply from now on.')).toBeInTheDocument();
    expect(sent).toEqual([{ name: 'Acme Europe', timeZone: 'Europe/Berlin', country: null }]);
    expect(within(await form()).getByLabelText('Name')).toHaveValue('Acme Europe');
  });

  it('sends nothing when nothing changed', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const sent = serve();
    await renderApp('/settings/workspace');
    await userEvent
      .setup()
      .click(within(await form()).getByRole('button', { name: 'Save changes' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toEqual([]);
  });

  it('checks the name before sending', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const sent = serve();
    await renderApp('/settings/workspace');
    const user = userEvent.setup();
    const f = await form();
    await user.clear(within(f).getByLabelText('Name'));
    await user.click(within(f).getByRole('button', { name: 'Save changes' }));
    expect(await within(f).findByText('This field is required.')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('keeps a stored country the list does not know', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve(settings({ country: 'AT' }));
    await renderApp('/settings/workspace');
    expect(within(await form()).getByLabelText(/Default country/)).toHaveValue('AT');
  });

  it('shows the API error and keeps the form', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    server.use(http.put(`${API}/settings/workspace`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/settings/workspace');
    const user = userEvent.setup();
    const f = await form();
    await user.type(within(f).getByLabelText('Name'), ' X');
    await user.click(within(f).getByRole('button', { name: 'Save changes' }));
    expect(await within(f).findByRole('alert')).toBeInTheDocument();
    expect(within(f).getByLabelText('Name')).toHaveValue('Acme GmbH X');
  });

  it('is read-only when the server says the caller cannot edit', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'admin.tenant.settings': 'own' })));
    serve(settings({ canEdit: false }));
    await renderApp('/settings/workspace');
    const f = await form();
    expect(within(f).getByLabelText('Name')).toBeDisabled();
    expect(within(f).queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(
      within(f).getByText('Only an administrator can change these settings.'),
    ).toBeInTheDocument();
  });

  it('is in the Administration menu for the administrator only', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    await renderApp('/');
    const admin = within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole(
      'list',
      { name: 'Administration' },
    );
    expect(within(admin).getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'href',
      '/settings/workspace',
    );
  });

  it('is not reachable for HR', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    await renderApp('/settings/workspace');
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Workspace settings' })).toBeNull(),
    );
    const menu = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(menu).queryByRole('link', { name: 'Workspace' })).toBeNull();
  });

  it.each([
    ['de', 'Arbeitsbereich', 'Änderungen speichern'],
    ['bg', 'Работно пространство', 'Запази промените'],
  ] as const)('is translated (%s)', async (language, title, save) => {
    await initTestI18n(language);
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    await renderApp('/settings/workspace');
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: save })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/settings:|countries\.|languages\./);
  });
});
