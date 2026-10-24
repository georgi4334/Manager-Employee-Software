import { expect, test } from '@playwright/test';
import { acceptInvitation, signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';
import { invitationFor } from '../support/mail';

/** A Monday three weeks ahead and the following Tuesday, as yyyy-mm-dd. */
function nextWeeks() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 21);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: iso(d), to: iso(end) };
}

test('an administrator invites an employee, who joins', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/employees/new');
  await page.getByLabel('First name').fill('Eva');
  await page.getByLabel('Last name').fill('Employee');
  await page.getByLabel('Email').fill(EMPLOYEE_EMAIL);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByText('Eva Employee').first()).toBeVisible();

  const employee = await page.context().newPage();
  await acceptInvitation(employee, invitationFor(EMPLOYEE_EMAIL));
  await expect(employee.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a leave request goes from the employee to the approver and back', async ({ browser }) => {
  const { from, to } = nextWeeks();
  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/leave');
  await expect(eva.getByText('Leave balance')).toBeVisible();
  await eva.getByLabel('Type', { exact: true }).selectOption({ label: 'Annual leave' });
  await eva.getByLabel('From', { exact: true }).fill(from);
  await eva.getByLabel('To', { exact: true }).fill(to);
  await expect(eva.getByText(/working days will be counted/)).toBeVisible();
  await eva.getByRole('button', { name: 'Send request' }).click();
  await expect(eva.getByText('Request sent. It waits for approval.')).toBeVisible();

  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/leave?tab=approvals');
  await expect(ada.getByText('Eva Employee')).toBeVisible();
  await ada.getByRole('button', { name: 'Approve', exact: true }).click();
  await ada.getByLabel('Comment (optional)').fill('Enjoy!');
  await ada.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(ada.getByText('No requests are waiting for you.')).toBeVisible();

  await eva.goto('/leave');
  await expect(eva.getByText('Approved').first()).toBeVisible();
  await eva.goto('/notifications');
  await expect(eva.getByText(/was approved/)).toBeVisible();
});

test('people without the permission see no approvals, and unknown pages are not found', async ({
  browser,
}) => {
  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/leave?tab=approvals');
  await expect(eva.getByRole('tab', { name: 'Approvals' })).toHaveCount(0);
  await eva.goto('/organization/new-nothing');
  await expect(eva.getByRole('heading', { name: /not found|404/i }).first()).toBeVisible();
});
