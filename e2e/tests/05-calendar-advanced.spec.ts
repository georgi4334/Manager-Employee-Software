import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('a repeating event with a guest: the guest answers, the organizer sees it', async ({
  browser,
}) => {
  const ada = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/calendar?view=agenda');
  await ada.getByRole('button', { name: 'New event' }).click();
  const form = ada.getByRole('form', { name: 'New event' });
  await form.getByLabel('Title').fill('Weekly sync');
  await form.getByLabel('Start time').fill('08:00');
  await form.getByLabel('End time').fill('08:30');
  await form.getByLabel('Repeats').selectOption('weekly');
  await form.getByLabel('Ends').selectOption('count');
  await form.getByLabel('Number of times').fill('3');
  await form.getByLabel('Reminder').selectOption({ label: '1 hour before' });
  await form.getByLabel('Invite colleagues (type a name)').fill('Eva');
  await form.getByRole('button', { name: 'Invite Eva Employee' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  const mine = ada.getByText('Weekly sync').first().locator('xpath=ancestor::li');
  await expect(mine).toContainText('Repeats weekly');
  await expect(mine).toContainText('Reminder: 1 hour before');
  // the guests and their answers are in the details
  await mine.getByRole('button', { name: 'Weekly sync' }).click();
  await expect(ada.getByRole('dialog', { name: 'Weekly sync' })).toContainText(
    'Eva Employee · No answer yet',
  );
  await ada.keyboard.press('Escape');

  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/calendar?view=agenda');
  await eva.getByRole('button', { name: 'Weekly sync' }).first().click();
  const theirs = eva.getByRole('dialog', { name: 'Weekly sync' });
  await expect(theirs).toContainText('Organizer: Ada Admin');
  await expect(theirs.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await theirs.getByRole('button', { name: 'Accept' }).click();
  await expect(theirs.getByText('Your answer: Accepted')).toBeVisible();

  await ada.reload();
  await ada.getByRole('button', { name: 'Weekly sync' }).first().click();
  await expect(ada.getByRole('dialog', { name: 'Weekly sync' })).toContainText(
    'Eva Employee · Accepted',
  );
});

test('one occurrence can be deleted without ending the series', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/calendar?view=agenda');
  const rows = page.getByText('Weekly sync');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Weekly sync' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Weekly sync' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('radio', { name: 'This event only' }).check();
  await dialog.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(before - 1);
});

test('find a time suggests a common free slot and fills the form', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/calendar?view=agenda');
  await page.getByRole('button', { name: 'New event' }).click();
  const form = page.getByRole('form', { name: 'New event' });
  await form.getByLabel('Invite colleagues (type a name)').fill('Eva');
  await form.getByRole('button', { name: 'Invite Eva Employee' }).click();
  await form.getByRole('button', { name: 'Find a time' }).click();
  await form.getByRole('button', { name: 'Search' }).click();
  const slots = form.getByRole('list', { name: 'Suggested times' });
  await expect(slots.getByRole('button').first()).toBeVisible();
  await slots.getByRole('button').first().click();
  await expect(form.getByLabel('Start time')).not.toHaveValue('');
  await expect(form.getByLabel('End time')).not.toHaveValue('');
});
