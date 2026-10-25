import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator gives a task to a staffed employee', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  const form = page.getByRole('form', { name: 'New task' });

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('This field is required.').first()).toBeVisible();

  await form.getByLabel('Project').selectOption({ label: 'WEB-1 · Website relaunch' });
  await form.getByLabel('Title').fill('Design the login');
  // only people on the project can be chosen: Eva is staffed there, the administrator is not
  const assignee = form.getByLabel('Assigned to');
  await expect(assignee.getByRole('option', { name: 'Eva Employee' })).toBeAttached();
  await expect(assignee.getByRole('option', { name: /Admin/ })).toHaveCount(0);
  await assignee.selectOption({ label: 'Eva Employee' });
  await form.getByLabel('Estimate (hours)').fill('3.5');
  await form.getByRole('button', { name: 'Save' }).click();

  const list = page.getByRole('list', { name: 'Tasks' });
  await expect(list.getByText('Design the login')).toBeVisible();
  await expect(list.getByText('WEB-1-1')).toBeVisible();
  await expect(list.getByText('Eva Employee')).toBeVisible();

  await page.goto('/projects');
  await page.getByText('Website relaunch').click();
  await expect(page.getByText('1 open task')).toBeVisible();
});

test('the employee sees her task, is told, moves it and cannot change more', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Assigned to me' }).check();
  const list = page.getByRole('list', { name: 'Tasks' });
  await expect(list.getByText('Design the login')).toBeVisible();
  await expect(list.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await list.getByLabel('Status of WEB-1-1').selectOption({ label: 'In progress' });
  await expect(list.getByLabel('Status of WEB-1-1')).toHaveValue('in_progress');

  await page.goto('/notifications');
  await expect(page.getByText('You were given the task WEB-1-1.').first()).toBeVisible();
});

test('the administrator sees the move on the board', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/tasks?view=board');
  const column = page.getByRole('region', { name: /In progress/ });
  await expect(column.getByText('Design the login')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'To do (0)' })).toBeVisible();
});
