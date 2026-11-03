import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

// The audit log viewer (docs/adr/0041-audit-log-viewer.md) shows the approval made in the leave spec.
test('the administrator reads and filters the audit log; an employee cannot', async ({
  page,
  browser,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Audit log' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();

  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Area' }).selectOption({ label: 'Leave' });
  await expect(page).toHaveURL(/area=leave/);
  const approved = main.getByRole('listitem').filter({ hasText: 'Leave approved' }).first();
  await expect(approved).toBeVisible();
  await expect(approved).toContainText('Ada');
  await approved.getByText('Recorded data').click();
  await approved.getByRole('button', { name: 'History of this record' }).click();
  await expect(main.getByText('History of one record')).toBeVisible();
  await expect(main.getByRole('listitem').filter({ hasText: 'Leave approved' })).toHaveCount(1);

  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await expect(
    eva
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Audit log' }),
  ).toHaveCount(0);
  expect((await eva.request.get('/api/v1/audit-log')).status()).toBe(403);
});
