import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('an employee schedules a 1:1 with their manager and writes notes', async ({ page }) => {
  // the administrator makes herself Eva's manager
  await signIn(page, ADMIN_EMAIL);
  const people = (await (await page.request.get('/api/v1/employees?pageSize=100')).json()) as {
    items: { id: string; firstName: string }[];
  };
  const id = (name: string) => people.items.find((p) => p.firstName === name)!.id;
  const res = await page.request.put(`/api/v1/org/employees/${id('Eva')}/assignment`, {
    data: { managerId: id('Ada'), departmentId: null },
  });
  expect(res.status()).toBe(204);

  const eva = await (
    await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 375, height: 800 } })
  ).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/one-on-ones');
  await eva.getByRole('button', { name: 'Schedule a 1:1' }).click();
  const form = eva.getByRole('form', { name: 'Schedule a 1:1' });
  await expect(form.getByLabel('With')).toHaveText(/My manager \(Ada Admin\)/);
  await form.getByLabel('Date').fill(inDays(7));
  await form.getByLabel('Time').fill('10:00');
  await form.getByLabel('Agenda (optional)').fill('Career plans');
  await form.getByRole('button', { name: 'Schedule' }).click();

  await expect(eva.getByRole('heading', { name: '1:1 with Ada Admin' })).toBeVisible();
  const notes = eva.getByRole('form', { name: 'Notes' });
  await expect(notes.getByLabel('Agenda')).toHaveValue('Career plans');
  await notes.getByLabel('Shared notes').fill('We agreed on a training budget');
  await notes.getByLabel('Your private notes').fill('Ask about the raise');
  await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(eva.getByText('Saved.')).toBeVisible();

  const items = eva.getByRole('form', { name: 'New action item' });
  await items.getByLabel('What needs to be done').fill('Send the course list');
  await items.getByRole('button', { name: 'Add' }).click();
  await expect(eva.getByRole('list', { name: 'Action items' })).toContainText(
    'Send the course list',
  );
});

test('the manager sees the shared notes but never the private ones', async ({ page, browser }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/one-on-ones');
  await expect(page.getByText('You are the manager')).toBeVisible();
  await page.getByRole('link', { name: '1:1 with Eva Employee' }).click();

  const notes = page.getByRole('form', { name: 'Notes' });
  await expect(notes.getByLabel('Shared notes')).toHaveValue('We agreed on a training budget');
  await expect(notes.getByLabel('Your private notes')).toHaveValue('');
  await expect(page.getByText('Ask about the raise')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Action items' })).toContainText(
    'Send the course list',
  );

  await notes.getByLabel('Your private notes').fill('Eva is ready for more');
  await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const items = page.getByRole('form', { name: 'New action item' });
  await items.getByLabel('What needs to be done').fill('Approve the budget');
  await expect(items.getByLabel('Who')).toHaveValue('');
  await items.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('checkbox', { name: 'Done: Approve the budget' }).click();
  await expect(page.getByRole('checkbox', { name: 'Done: Approve the budget' })).toBeChecked();

  // Eva still sees only her own private note
  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/one-on-ones');
  await eva.getByRole('link', { name: '1:1 with Ada Admin' }).click();
  await expect(eva.getByLabel('Your private notes')).toHaveValue('Ask about the raise');
  await expect(eva.getByText('Eva is ready for more')).toHaveCount(0);

  // marking it done moves it to the past
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await page.goto('/one-on-ones?status=past');
  await expect(page.getByRole('link', { name: '1:1 with Eva Employee' })).toBeVisible();
});
