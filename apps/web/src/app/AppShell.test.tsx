import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/tests/utils';
import { NAV_ITEMS } from './nav';

describe('AppShell navigation', () => {
  it('renders every module in the desktop sidebar', () => {
    renderApp('/');
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const item of NAV_ITEMS) {
      expect(within(sidebar).getByRole('link', { name: item.label })).toBeInTheDocument();
    }
  });

  it('marks the current page as active', () => {
    renderApp('/leave');
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
    renderApp('/');
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(sidebar).getByRole('link', { name: 'Employees' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Employees' })).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for unknown routes', async () => {
    renderApp('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('mobile navigation', () => {
  it('shows only primary modules in the bottom bar', () => {
    renderApp('/');
    const bar = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(bar).getByRole('link', { name: 'Attendance' })).toBeInTheDocument();
    expect(within(bar).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
  });

  it('opens the More menu, navigates and closes it', async () => {
    renderApp('/');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More navigation' });
    await userEvent.click(within(menu).getByRole('link', { name: 'Organization' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Organization' })).toBeInTheDocument();
  });

  it('closes the More menu with Escape', async () => {
    renderApp('/');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('theme toggle', () => {
  it('cycles system -> light -> dark -> system and updates the document theme', async () => {
    renderApp('/');
    const toggle = () => screen.getByRole('button', { name: /^Theme:/ });
    expect(toggle()).toHaveAccessibleName('Theme: system. Switch to light');

    await userEvent.click(toggle());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle()).toHaveAccessibleName('Theme: light. Switch to dark');

    await userEvent.click(toggle());
    expect(document.documentElement.dataset.theme).toBe('dark');

    await userEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName('Theme: system. Switch to light');
  });
});
