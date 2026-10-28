import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

const widgets = (page: Page) => page.getByRole('list', { name: 'Dashboard' });

test('an administrator arranges the dashboard for everybody', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await expect(widgets(page).getByRole('heading', { name: 'Latest notifications' })).toBeVisible();

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Remove Latest notifications' }).click();
  await page.getByRole('button', { name: 'Add People' }).click();
  await page.getByRole('button', { name: 'Move People up' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();

  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  await expect(widgets(page).getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(widgets(page).getByRole('heading', { name: 'Latest notifications' })).toHaveCount(0);
  // the order is stored: People sits right before the last default widget
  const titles = await widgets(page).getByRole('heading', { level: 2 }).allTextContents();
  expect(titles.indexOf('People')).toBe(titles.length - 2);
});

test('everybody sees the layout; only the administrator can change it', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await expect(widgets(page).getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(widgets(page).getByRole('heading', { name: 'Latest notifications' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Customize' })).toHaveCount(0);
  // a widget an employee may not use is not shown at all
  await expect(widgets(page).getByRole('heading', { name: 'Leave to approve' })).toHaveCount(0);
});

test('the administrator can go back to the default', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  await expect(widgets(page).getByRole('heading', { name: 'Latest notifications' })).toBeVisible();
  await expect(widgets(page).getByRole('heading', { name: 'People' })).toHaveCount(0);
});
