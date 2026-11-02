import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

// The command palette (docs/adr/0039-command-palette.md) finds people and tasks created by the earlier specs.
test('Ctrl+K finds a person and a task and jumps there', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search and go' });
  await dialog.getByRole('combobox').fill('eva emp');
  await dialog.getByRole('option', { name: /Eva Employee/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Eva Employee' })).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  await dialog.getByRole('combobox').fill('design the login');
  await expect(dialog.getByRole('option', { name: /Design the login/ })).toBeVisible();
  await dialog.getByRole('option', { name: /Design the login/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Design the login')).toBeVisible();
});
