import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

// Workspace settings (docs/adr/0043-workspace-settings.md): the administrator renames the workspace and everybody
// sees the new name; an employee has no such page. The name is put back so later specs see the usual workspace.
test.use({ viewport: { width: 1280, height: 800 } });

test('the administrator renames the workspace; an employee cannot', async ({ page, browser }) => {
  await signIn(page, ADMIN_EMAIL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Workspace' })
    .click();
  const form = page.getByRole('form', { name: 'Workspace settings' });
  const name = form.getByLabel('Name');
  const original = await name.inputValue();
  await name.fill('Acme Europe');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved. The changes apply from now on.')).toBeVisible();

  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await expect(page.getByRole('dialog')).toContainText('Acme Europe');
  await page.keyboard.press('Escape');

  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.getByRole('button', { name: 'Profile and settings' }).click();
  await expect(eva.getByRole('dialog')).toContainText('Acme Europe');
  expect(
    (await eva.request.put('/api/v1/settings/workspace', { data: { name: 'Mine' } })).status(),
  ).toBe(403);

  await page.reload();
  await page.getByRole('form', { name: 'Workspace settings' }).getByLabel('Name').fill(original);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved. The changes apply from now on.')).toBeVisible();
});
