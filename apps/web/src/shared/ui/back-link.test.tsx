import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

describe('BackLink', () => {
  it('sub-pages offer one clearly named way back to their list', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const { router } = await renderApp('/roles/new');
    const back = await screen.findByRole('link', { name: 'All roles' });
    // the arrow is decoration; the name is only the text
    expect(within(back).getByText('All roles')).toBeInTheDocument();
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(back);
    expect(router.state.location.pathname).toBe('/roles');
  });

  it('is the same control on the notification settings page', async () => {
    await renderApp('/notifications/settings');
    const back = await screen.findByRole('link', { name: 'Back to notifications' });
    expect(back).toHaveAttribute('href', '/notifications');
    expect(back.className).toContain('rounded-full');
  });
});
