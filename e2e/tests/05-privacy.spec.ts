import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an employee downloads everything held about them', async ({ page }, testInfo) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/profile');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download my data' }).click(),
  ]);
  const path = testInfo.outputPath('export.json');
  await download.saveAs(path);
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  expect(download.suggestedFilename()).toBe('intime-data-export.json');
  expect(doc.account.email).toBe(EMPLOYEE_EMAIL);
  expect(doc.employee.firstName).toBe('Eva');
  // the approved request of the leave spec and the pending one of the integrations spec
  expect(doc.leave.requests.map((r: { status: string }) => r.status).sort()).toEqual([
    'approved',
    'pending',
  ]);
  expect(doc.attendance.length).toBeGreaterThanOrEqual(2);
  expect(doc.calendarEvents.map((e: { title: string }) => e.title)).toEqual(['Dentist']);
  expect(JSON.stringify(doc)).not.toMatch(/passwordHash|tokenHash/);
});

test('a former employee can be erased only after deactivation, and then stays a placeholder', async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/employees');
  await page.getByRole('link', { name: /Eva Employee/ }).click();
  await expect(page.getByRole('button', { name: 'Erase personal data' })).toHaveCount(0); // still active

  await page.getByRole('button', { name: 'Deactivate' }).click();
  await page
    .getByRole('group', { name: /Deactivate Eva Employee/ })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.getByText('Inactive').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Data and privacy' }).click();
  await page.getByRole('button', { name: 'Erase personal data' }).click();
  const confirm = page.getByRole('button', { name: 'Erase permanently' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: /irreversible/ }).check();
  await confirm.click();
  await expect(page.getByText('Eva Employee')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reactivate' })).toHaveCount(0);

  // the former employee can no longer sign in
  const former = await page.context().browser()!.newPage();
  await former.goto('/login');
  await former.getByLabel('Email').fill(EMPLOYEE_EMAIL);
  await former.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await former.getByRole('button', { name: 'Sign in' }).click();
  await expect(former.getByText('Incorrect email or password.')).toBeVisible();
});
