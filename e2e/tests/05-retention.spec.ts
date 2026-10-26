import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator reads the Bulgarian retention policy, changes the period and switches it on and off', async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/retention');
  await expect(page.getByRole('heading', { name: 'Data retention', level: 1 })).toBeVisible();
  await expect(page.getByText(/not legal advice/)).toBeVisible();
  await expect(page.getByText('Bulgaria', { exact: true })).toBeVisible();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();

  // a wrong period is refused before anything is sent, a right one is saved
  const form = page.getByRole('form', { name: 'Retention period' });
  await form.getByLabel('Months after the termination date').fill('6');
  await form.getByRole('button', { name: 'Save period' }).click();
  await expect(form.getByText(/from 12 to 600/)).toBeVisible();
  await form.getByLabel('Months after the termination date').fill('48');
  await form.getByRole('button', { name: 'Save period' }).click();

  // switching on asks first and can be cancelled
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/anonymised 48 months after their termination date/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('button', { name: 'Yes, turn on' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Months after the termination date')).toHaveValue('48');
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
});

test('an employee has no access to the retention page', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await expect(page.getByRole('link', { name: 'Data retention' })).toHaveCount(0);
  await page.goto('/retention');
  await expect(page.getByText('No access')).toBeVisible();
});
