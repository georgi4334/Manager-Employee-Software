import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

test('an administrator creates, changes and deletes a custom role', async ({ browser }) => {
  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/roles');
  const list = ada.getByRole('list', { name: 'Roles' });
  await expect(list).toContainText('Admin');
  await expect(list).toContainText('System');

  await ada.getByRole('link', { name: 'New role' }).click();
  const form = ada.getByRole('form', { name: 'New role' });
  await form.getByLabel('Name').fill('Contractor');
  await form.getByLabel('Description (optional)').fill('Outsourced staff');
  await form
    .getByLabel('See the organization chart, departments and teams')
    .selectOption({ label: 'Everyone' });
  await form.getByRole('button', { name: 'Save role' }).click();
  await expect(ada.getByRole('heading', { name: 'Contractor' })).toBeVisible();

  // it is a custom role with one permission, and it can be changed
  await ada.goto('/roles');
  await expect(list).toContainText('Contractor');
  await ada.getByRole('link', { name: /Contractor/ }).click();
  const edit = ada.getByRole('form', { name: 'Change role' });
  await edit.getByLabel('Name').fill('External contractor');
  await edit.getByLabel('See the organization chart, departments and teams').selectOption({
    label: 'No access',
  });
  await edit.getByRole('button', { name: 'Save role' }).click();
  await expect(ada.getByText(/The role was saved/)).toBeVisible();
  await expect(ada.getByRole('heading', { name: 'External contractor' })).toBeVisible();

  // system roles cannot be changed
  await ada.goto('/roles');
  await ada.getByRole('link', { name: /^Admin/ }).click();
  await expect(ada.getByText('System role (fixed)')).toBeVisible();
  await expect(ada.getByRole('form')).toHaveCount(0);

  // deleting asks first
  await ada.goto('/roles');
  await ada.getByRole('link', { name: /External contractor/ }).click();
  await ada.getByRole('button', { name: 'Delete this role' }).click();
  await ada.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(ada.getByRole('list', { name: 'Roles' })).not.toContainText('External contractor');
});
