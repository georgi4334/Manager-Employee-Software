import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_STORAGE_KEY, reloadSidebarState } from '@/shared/stores/sidebar.store';
import { initTestI18n } from '@/tests/i18n';
import { server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const menu = () => screen.getByRole('navigation', { name: 'Main navigation' });
const shell = () => menu().closest('aside')!.parentElement!;

describe('collapsible sidebar', () => {
  it('collapses to an icon rail that keeps every name, and expands again', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    await renderApp('/leave');
    const user = userEvent.setup();
    expect(shell().style.getPropertyValue('--sidebar-w')).toBe('16rem');

    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(shell().style.getPropertyValue('--sidebar-w')).toBe('4.75rem');
    expect(menu().closest('aside')).toHaveAttribute('data-collapsed', 'true');
    // labels are hidden visually but stay the links' names, and the current page is still marked
    const leave = within(menu()).getByRole('link', { name: 'Leave' });
    expect(leave).toHaveAttribute('aria-current', 'page');
    expect(within(leave).getByText('Leave')).toHaveClass('sr-only');
    // group headings still name their lists; sections of the open page are left to the page's tabs
    expect(within(menu()).getByRole('list', { name: 'My workday' })).toBeInTheDocument();
    expect(within(menu()).queryByRole('list', { name: /Sections of/ })).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');

    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(shell().style.getPropertyValue('--sidebar-w')).toBe('16rem');
    expect(within(menu()).getByText('Leave')).not.toHaveClass('sr-only');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded');
  });

  it('remembers the choice on the next visit', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    reloadSidebarState();
    await renderApp('/');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
    expect(shell().style.getPropertyValue('--sidebar-w')).toBe('4.75rem');
  });

  it('ignores an unknown stored value and starts expanded', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'sideways');
    reloadSidebarState();
    await renderApp('/');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });

  it('shows the label beside a rail entry on hover and focus, and hides it with Escape', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    reloadSidebarState();
    await renderApp('/');
    const calendar = within(menu()).getByRole('link', { name: 'Calendar' });
    const tip = () => document.querySelector('[data-rail-tip]');

    fireEvent.mouseEnter(calendar);
    expect(tip()).toHaveTextContent('Calendar');
    expect(tip()).toHaveAttribute('aria-hidden', 'true');
    fireEvent.mouseLeave(calendar);
    expect(tip()).toBeNull();

    fireEvent.focus(calendar);
    expect(tip()).toHaveTextContent('Calendar');
    fireEvent.keyDown(calendar, { key: 'Escape' });
    expect(tip()).toBeNull();
  });

  it.each([
    ['de', 'Menü einklappen', 'Menü ausklappen'],
    ['bg', 'Свий менюто', 'Разгъни менюто'],
  ] as const)('is translated (%s)', async (language, collapse, expand) => {
    await initTestI18n(language);
    await renderApp('/');
    await userEvent.setup().click(screen.getByRole('button', { name: collapse }));
    expect(screen.getByRole('button', { name: expand })).toBeInTheDocument();
  });
});
