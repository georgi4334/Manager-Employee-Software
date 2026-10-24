import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { EMPLOYEE_EMAIL } from '../support/constants';

test('an employee checks in and out and types in a forgotten period', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/attendance');
  await expect(page.getByText('You are not checked in.')).toBeVisible();
  await page.getByLabel('Where').selectOption({ label: 'Remote' });
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText(/Working since \d\d:\d\d \(Remote\)/)).toBeVisible();
  // a second check-in is not offered while one is open
  await expect(page.getByRole('button', { name: 'Check in' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByText(/Recorded today:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in' })).toBeVisible();

  const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  await page.getByRole('button', { name: 'Add a period' }).click();
  const form = page.getByRole('form', { name: 'Add a period' });
  await form.getByLabel('Date').fill(yesterday);
  await form.getByLabel('From').fill('09:00');
  await form.getByLabel('To').fill('17:30');
  await form.getByRole('button', { name: 'Save' }).click();
  await page.goto('/attendance?tab=history');
  await expect(page.getByText('09:00 – 17:30')).toBeVisible();
  await expect(page.getByText(/Total: \d+ h \d+ min/)).toBeVisible();
});

test('an overlapping period is refused with a clear message', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/attendance');
  const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  await page.getByRole('button', { name: 'Add a period' }).click();
  const form = page.getByRole('form', { name: 'Add a period' });
  await form.getByLabel('Date').fill(yesterday);
  await form.getByLabel('From').fill('10:00');
  await form.getByLabel('To').fill('11:00');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This overlaps another record of the same person.')).toBeVisible();
});
