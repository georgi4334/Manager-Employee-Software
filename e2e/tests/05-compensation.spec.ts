import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator records pay that only HR and administrators can see', async ({
  browser,
}) => {
  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/employees');
  await ada.getByRole('link', { name: /Eva Employee/ }).click();
  const card = ada.getByRole('heading', { name: 'Compensation' }).locator('xpath=ancestor::div[1]');
  await expect(card).toContainText('No pay has been recorded yet.');
  await card.getByRole('button', { name: 'Add or change pay' }).click();
  const form = ada.getByRole('form', { name: 'Compensation' });
  await form.getByLabel('Amount').fill('3 500,50');
  await form.getByRole('button', { name: 'Save pay' }).click();
  await expect(card).toContainText('€3,500.50 per month');
  await expect(card).toContainText('In force');

  // Eva sees nothing of it on her profile, and the server refuses her the numbers
  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  const me = (await (await eva.request.get('/api/v1/employees/me')).json()) as { id: string };
  await eva.goto(`/employees/${me.id}`);
  await expect(eva.getByRole('heading', { name: 'Working hours' })).toBeVisible();
  await expect(eva.getByRole('heading', { name: 'Compensation' })).toHaveCount(0);
  const refused = await eva.request.get(`/api/v1/employees/${me.id}/compensation`);
  expect(refused.status()).toBe(403);
  // …but her own data export contains her records
  const download = await eva.request.get('/api/v1/privacy/export');
  expect(JSON.stringify(await download.json())).toContain('350050');
});

test('nobody changes their own pay', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  const me = (await (await page.request.get('/api/v1/employees/me')).json()) as { id: string };
  await page.goto(`/employees/${me.id}`);
  const card = page
    .getByRole('heading', { name: 'Compensation' })
    .locator('xpath=ancestor::div[1]');
  await expect(card).toContainText('another HR or administrator account');
  await expect(card.getByRole('button', { name: 'Add or change pay' })).toHaveCount(0);
  const refused = await page.request.put(`/api/v1/employees/${me.id}/compensation`, {
    data: { validFrom: '2026-01-01', basis: 'monthly', amountMinor: 100000 },
  });
  expect(refused.status()).toBe(403);
});
