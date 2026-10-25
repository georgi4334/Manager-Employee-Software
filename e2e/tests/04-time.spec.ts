import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an employee tracks time with the timer and by hand, and submits the week', async ({
  page,
}) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/time');
  await expect(page.getByRole('tablist')).toHaveCount(0); // no approvals tab for her

  // timer: start, see it run, stop
  const start = page.getByRole('form', { name: 'Start the timer' });
  await start.getByRole('button', { name: 'Start' }).click();
  await expect(start.getByText('This field is required.')).toBeVisible();
  await start.getByLabel('Project').selectOption({ label: 'WEB-1 · Website relaunch' });
  await start.getByLabel('Note (optional)').fill('Focus work');
  await start.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Running on WEB-1 · Website relaunch')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Start the timer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('form', { name: 'Start the timer' })).toBeVisible();
  await expect(page.getByText('Focus work')).toBeVisible();
  await expect(page.getByText('0:01 h').first()).toBeVisible(); // at least a minute, rounded up

  // by hand: a bad duration, a good one, and a day over 24 hours
  await page.getByRole('button', { name: 'Add time' }).click();
  const form = page.getByRole('form', { name: 'Add time' });
  await form.getByLabel('Project').selectOption({ label: 'WEB-1 · Website relaunch' });
  await form.getByLabel('Duration').fill('soon');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText(/Enter a duration like 1:30/)).toBeVisible();
  await form.getByLabel('Duration').fill('1:30');
  await form.getByLabel('Note (optional)').fill('Design review');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Design review')).toBeVisible();
  await expect(page.getByText('1:30 h').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add time' }).click();
  const long = page.getByRole('form', { name: 'Add time' });
  await long.getByLabel('Project').selectOption({ label: 'WEB-1 · Website relaunch' });
  await long.getByLabel('Duration').fill('16');
  await long.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('16:00 h').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add time' }).click();
  const over = page.getByRole('form', { name: 'Add time' });
  await over.getByLabel('Project').selectOption({ label: 'WEB-1 · Website relaunch' });
  await over.getByLabel('Duration').fill('9');
  await over.getByRole('button', { name: 'Save' }).click();
  await expect(over.getByText('A day cannot hold more than 24 hours.')).toBeVisible();
  await over.getByRole('button', { name: 'Cancel' }).click();
  await page
    .locator('ul > li')
    .filter({ hasText: '16:00 h' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('16:00 h')).toHaveCount(0);

  // submit: the week is locked afterwards
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText(/This week is submitted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit week' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add time' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

test('an administrator approves the week', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/time?tab=approvals');
  const row = page.getByRole('listitem').filter({ hasText: 'Eva Employee' });
  await row.getByRole('button', { name: 'Show the time of Eva Employee' }).click();
  await expect(row.getByText('Design review')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0); // read only
  await row.getByRole('button', { name: 'Approve the week of Eva Employee' }).click();
  await expect(page.getByText('No timesheets to show.')).toBeVisible();
  await page.getByLabel('Status').selectOption({ label: 'Approved' });
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Eva Employee' }).getByText('Approved'),
  ).toBeVisible();
});

test('the employee is told and sees the approved week locked', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/time');
  await expect(page.getByText(/approved and locked/)).toBeVisible();
  await page.goto('/notifications');
  await expect(
    page.getByText(/Your timesheet for the week of .* was approved\./).first(),
  ).toBeVisible();
});
