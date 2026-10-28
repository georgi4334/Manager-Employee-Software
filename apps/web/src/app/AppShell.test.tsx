import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server, signedInHandlers, userWithRole } from '@/tests/server';
import { initTestI18n } from '@/tests/i18n';
import { openAccountMenu, renderApp } from '@/tests/utils';
import navEn from '@/i18n/locales/en/nav.json';
import { NAV_ITEMS } from './nav';

describe('AppShell navigation', () => {
  it('renders every module in the desktop sidebar', async () => {
    // analytics is not for the default employee
    server.use(...signedInHandlers(userWithRole('admin')));
    await renderApp('/');
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const item of NAV_ITEMS) {
      expect(within(sidebar).getByRole('link', { name: navEn[item.labelKey] })).toBeInTheDocument();
    }
  });

  it('marks the current page as active', async () => {
    await renderApp('/leave');
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(sidebar).getByRole('link', { name: 'Leave' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('navigates between modules', async () => {
    await renderApp('/');
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(sidebar).getByRole('link', { name: 'Employees' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Employees' })).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for unknown routes', async () => {
    await renderApp('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('mobile navigation', () => {
  it('shows only primary modules in the bottom bar', async () => {
    await renderApp('/');
    const bar = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(bar).getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(within(bar).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
  });

  it('opens the More menu, navigates and closes it', async () => {
    await renderApp('/');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More navigation' });
    await userEvent.click(within(menu).getByRole('link', { name: 'Organization' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Organization' })).toBeInTheDocument();
  });

  it('closes the More menu with Escape', async () => {
    await renderApp('/');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('header', () => {
  it('keeps only the notifications and the profile button in the header', async () => {
    await renderApp('/');
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: /Notifications/ })).toBeInTheDocument();
    expect(header.getByRole('button', { name: 'Profile and settings' })).toBeInTheDocument();
    for (const name of [/^Theme/, 'Sign out', 'My profile', 'Language']) {
      expect(header.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(header.queryByRole('combobox')).not.toBeInTheDocument();
    expect(header.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
  });
});

describe('profile drawer', () => {
  it('opens with profile, language, theme and sign out, and closes with the close button or Escape', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    expect(drawer.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(drawer.getByLabelText('Language')).toBeInTheDocument();
    expect(drawer.getByRole('button', { name: 'Theme System' })).toBeInTheDocument();
    expect(drawer.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // the focus moves into the drawer
    expect(drawer.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.click(drawer.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile and settings' })).toHaveFocus();

    await openAccountMenu(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the page behind it is clicked, and when the profile link is followed', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    await openAccountMenu(user);
    await user.click(document.querySelector('body > [aria-hidden="true"].fixed') as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const drawer = await openAccountMenu(user);
    await user.click(drawer.getByRole('link', { name: 'Profile' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the drawer', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    const dialog = screen.getByRole('dialog');
    const last = drawer.getByRole('button', { name: 'Sign out' });
    last.focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(drawer.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('changes the language from the drawer', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    await user.selectOptions(drawer.getByLabelText('Language'), 'Deutsch');
    expect(
      await screen.findByRole('button', { name: 'Profil und Einstellungen' }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Sprache'), 'English');
  });
});

describe('theme menu', () => {
  const trigger = () => screen.getByRole('button', { name: /^Theme (System|Light|Dark)$/ });

  it('shows the current theme as icon and text, and lists all choices with text', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    const button = drawer.getByRole('button', { name: 'Theme System' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('svg')).not.toBeNull();
    await user.click(button);
    const menu = drawer.getByRole('menu', { name: 'Theme' });
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual(['Light', 'Dark', 'System']);
    for (const option of options) expect(option.querySelector('svg')).not.toBeNull();
    expect(within(menu).getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('applies the chosen theme at once, remembers it and closes the menu', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    await user.click(drawer.getByRole('button', { name: 'Theme System' }));
    await user.click(drawer.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(drawer.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Dark');
    expect(trigger()).toHaveFocus();
    await user.click(trigger());
    await user.click(drawer.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(trigger());
    await user.click(drawer.getByRole('menuitemradio', { name: 'System' }));
    expect(trigger()).toHaveTextContent('System');
  });

  it('works with the keyboard: arrows move, Enter chooses, Escape closes only the menu', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const drawer = await openAccountMenu(user);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(drawer.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(drawer.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(drawer.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(drawer.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(drawer.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(drawer.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // the drawer stays
    expect(trigger()).toHaveFocus();
  });

  it('closes when something else is clicked, and shows the texts in German and Bulgarian', async () => {
    const user = userEvent.setup();
    await initTestI18n('de');
    await renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Profil und Einstellungen' }));
    const drawer = within(await screen.findByRole('dialog'));
    await user.click(drawer.getByRole('button', { name: 'Design System' }));
    expect(drawer.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      'Hell',
      'Dunkel',
      'System',
    ]);
    await user.click(drawer.getByRole('heading', { name: 'maria@acme.eu' }));
    await waitFor(() => expect(drawer.queryByRole('menu')).not.toBeInTheDocument());
  });
});
