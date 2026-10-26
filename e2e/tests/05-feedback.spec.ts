import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('a colleague gives private feedback that only the recipient reads', async ({
  page,
  browser,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Give feedback' }).click();
  const form = page.getByRole('form', { name: 'Give feedback' });
  await form.getByLabel('To').selectOption({ label: 'Eva Employee' });
  await form.getByLabel('Kind').selectOption('constructive');
  await form.getByLabel('Your feedback').fill('Please share your plans earlier');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Feedback sent.')).toBeVisible();
  await page.getByRole('button', { name: 'Given' }).click();
  await expect(page.getByRole('list', { name: 'Given' })).toContainText(
    'Please share your plans earlier',
  );

  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/feedback');
  const received = eva.getByRole('list', { name: 'Received' });
  await expect(received).toContainText('Ada Admin to Eva Employee');
  await expect(received).toContainText('Please share your plans earlier');
  await expect(received).toContainText('Only the recipient');
  // she cannot take it back, only report it
  await expect(eva.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('a reported item reaches the moderator, who keeps it', async ({ page, browser }) => {
  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/feedback');
  await eva.getByRole('button', { name: 'Report to a moderator' }).click();
  await expect(eva.getByText('Reported to a moderator')).toBeVisible();

  await signIn(page, ADMIN_EMAIL);
  await page.goto('/feedback?box=reported');
  // the moderator wrote it herself, so she may not decide on it
  await expect(page.getByText('No feedback is waiting for a decision.')).toBeVisible();
});
