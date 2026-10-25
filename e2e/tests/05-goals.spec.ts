import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator sets a company goal with a key result and moves its progress', async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New goal' }).click();
  const form = page.getByRole('form', { name: 'New goal' });
  await form.getByLabel('Kind of goal').selectOption('company');
  await form.getByLabel('Title').fill('Grow the customer base');
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Grow the customer base' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a key result' }).click();
  const kr = page.getByRole('form', { name: 'New key result' });
  await kr.getByLabel('Key result').fill('Paying customers');
  await kr.getByLabel('Target value').fill('200');
  await kr.getByLabel('Current value').fill('50');
  await kr.getByRole('button', { name: 'Add' }).click();

  const row = page.getByRole('list', { name: 'Key results' }).getByRole('listitem');
  await expect(row).toContainText('Paying customers');
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

  // progress is calculated from the key result and shows in the check-in
  const update = page.getByRole('form', { name: 'Update Paying customers' });
  await update.getByLabel('Current value').fill('100');
  await update.getByRole('button', { name: 'Update' }).click();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await page.getByLabel('What changed? (optional)').fill('Halfway there');
  await page.getByRole('button', { name: 'Record check-in' }).click();
  await expect(page.getByRole('list', { name: 'Check-ins' })).toContainText('Halfway there');
  await expect(page.getByRole('list', { name: 'Check-ins' })).toContainText('50 %');
});

test('an employee sees the company goal, aligns a personal goal to it and cannot change it', async ({
  page,
}) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/goals');
  await page.getByRole('link', { name: 'Grow the customer base' }).click();
  await expect(page.getByRole('heading', { name: 'Grow the customer base' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a key result' })).toHaveCount(0);

  await page.goto('/goals');
  await page.getByRole('button', { name: 'New goal' }).click();
  const form = page.getByRole('form', { name: 'New goal' });
  await form.getByLabel('Title').fill('Win three accounts');
  await form
    .getByLabel('Contributes to')
    .selectOption({ label: 'Grow the customer base (Company)' });
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Win three accounts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Grow the customer base' })).toBeVisible();
  await page.goto('/goals');
  await expect(page.getByText('2 goals')).toBeVisible();
  await page.getByRole('button', { name: 'Personal' }).click();
  await expect(page.getByText('1 goal', { exact: true })).toBeVisible();
});
