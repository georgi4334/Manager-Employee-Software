import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an employee adds a personal event that nobody else sees', async ({ browser }) => {
  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/calendar?view=agenda');
  await eva.getByRole('button', { name: 'New event' }).click();
  const form = eva.getByRole('form', { name: 'New event' });
  await form.getByLabel('Title').fill('Dentist');
  await form.getByLabel('Start time').fill('09:00');
  await form.getByLabel('End time').fill('10:30');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(eva.getByText('Dentist')).toBeVisible();
  await expect(eva.getByText('09:00 – 10:30')).toBeVisible();
  await expect(eva.getByText('My events', { exact: true }).first()).toBeVisible();

  const ada = await (await browser.newContext()).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/calendar?view=agenda');
  await expect(ada.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(ada.getByText('Dentist')).toHaveCount(0);
});

test('a company event reaches everybody, and only administrators can change it', async ({
  browser,
}) => {
  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/calendar?view=agenda');
  await ada.getByRole('button', { name: 'New event' }).click();
  const form = ada.getByRole('form', { name: 'New event' });
  await form.getByLabel('Calendar').selectOption({ label: 'Everybody' });
  await form.getByLabel('Title').fill('Company picnic');
  await form.getByLabel('All day').check();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(ada.getByText('Company picnic')).toBeVisible();

  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/calendar?view=agenda');
  const row = eva.getByText('Company picnic').locator('xpath=ancestor::li');
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(ada.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
});

test('views switch and the month shows the event day', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/calendar?view=month');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: /, 2 entries$/ }).first()).toBeVisible();
  for (const view of ['Week', 'Day', 'Agenda', 'Month']) {
    await page.getByRole('tab', { name: view }).click();
    await expect(page.getByRole('tab', { name: view })).toHaveAttribute('aria-selected', 'true');
  }
});
