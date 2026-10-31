import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

test('an administrator creates, changes, moves and deletes a custom role', async ({ browser }) => {
  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/roles');
  const list = ada.getByRole('list', { name: 'Role hierarchy' });
  await expect(list).toContainText('Admin');
  await expect(list).toContainText('System');
  // the default tree: Admin > HR > Manager > Employee
  await expect(ada.getByRole('list', { name: 'Roles under Manager' })).toContainText('Employee');

  await ada.getByRole('link', { name: 'New role' }).click();
  const form = ada.getByRole('form', { name: 'New role' });
  await form.getByLabel('Name', { exact: true }).fill('Contractor');
  await form.getByLabel('Description (optional)').fill('Outsourced staff');
  // modules without permissions start collapsed
  await form.getByText('Organization', { exact: true }).click();
  await form
    .getByLabel('See the organization chart, departments and teams', { exact: true })
    .selectOption({ label: 'Everyone' });
  await form.getByRole('button', { name: 'Save role' }).click();
  await expect(ada.getByRole('heading', { name: 'Contractor' })).toBeVisible();

  // it is a custom role with one permission, and it can be changed
  await ada.goto('/roles');
  await expect(list).toContainText('Contractor');
  await ada.getByRole('link', { name: /Contractor/ }).click();
  const edit = ada.getByRole('form', { name: 'Change role' });
  await edit.getByLabel('Name', { exact: true }).fill('External contractor');
  await edit
    .getByLabel('See the organization chart, departments and teams', { exact: true })
    .selectOption({
      label: 'No access',
    });
  await edit.getByRole('button', { name: 'Save role' }).click();
  await expect(ada.getByText(/The role was saved/)).toBeVisible();
  await expect(ada.getByRole('heading', { name: 'External contractor' })).toBeVisible();

  // it moves in the tree without changing any permission
  await ada.goto('/roles');
  await ada.getByRole('button', { name: 'Move External contractor' }).click();
  const dialog = ada.getByRole('dialog', { name: 'Move External contractor' });
  // each option names its place in the tree
  await dialog.getByLabel('Sits under').selectOption({ label: 'Admin › HR › Manager' });
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog).toBeHidden();
  await expect(ada.getByRole('list', { name: 'Roles under Manager' })).toContainText(
    'External contractor',
  );

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
  await expect(ada.getByRole('list', { name: 'Role hierarchy' })).not.toContainText(
    'External contractor',
  );
});
