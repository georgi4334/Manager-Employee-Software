import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

const REMINDERS_TOKEN = 'e2e-reminders-token-e2e-reminders-token-1234';

/** A Monday five weeks ahead and the following Tuesday, as yyyy-mm-dd. */
function later() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 35);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: iso(d), to: iso(end) };
}

test('the employee asks for leave and compares presence with time', async ({ page }) => {
  const { from, to } = later();
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/leave');
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Annual leave' });
  await page.getByLabel('From', { exact: true }).fill(from);
  await page.getByLabel('To', { exact: true }).fill(to);
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Request sent. It waits for approval.')).toBeVisible();

  await page.goto('/time');
  await page.getByRole('button', { name: 'Compare with attendance' }).click();
  const panel = page.getByRole('region', { name: 'Presence and logged time' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Only a mirror/)).toBeVisible();
  await expect(panel.getByText(/present \d+:\d\d h · logged \d+:\d\d h/).first()).toBeVisible();
});

test('the approver sees which projects the leave collides with', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/leave?tab=approvals');
  const row = page.getByRole('listitem').filter({ hasText: 'Eva Employee' });
  await expect(row).toBeVisible();
  await row
    .getByRole('button', { name: 'Check the project impact of the request of Eva Employee' })
    .click();
  await expect(row.getByText('WEB-1 · Website relaunch')).toBeVisible();
  await expect(row.getByText('API-2 · Public API')).toBeVisible();
  // it is only a warning: the request can still be decided
  await expect(row.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
});

test('the reminder hook answers only to the right token', async ({ request }) => {
  const url = '/api/v1/internal/reminders/run';
  expect((await request.post(url)).status()).toBe(401);
  expect(
    (
      await request.post(url, {
        headers: { Authorization: 'Bearer wrong-token-wrong-token-wrong-token-xx' },
      })
    ).status(),
  ).toBe(401);
  const ok = await request.post(url, { headers: { Authorization: `Bearer ${REMINDERS_TOKEN}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({
    attendance: expect.any(Number),
    timers: expect.any(Number),
    events: expect.any(Number),
    erased: expect.any(Number),
  });
});
