import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator sets part-time working hours and capacity follows', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/employees');
  await page
    .getByRole('link', { name: /Eva Employee/ })
    .first()
    .click();

  const card = page.getByRole('heading', { name: 'Working hours' }).locator('..');
  await expect(card.getByText(/Standard week: 8 hours, Monday to Friday/)).toBeVisible();
  await expect(card.getByText('Per week: 40:00 h')).toBeVisible();

  await card.getByRole('button', { name: 'Change working hours' }).click();
  const form = page.getByRole('form', { name: 'Working hours' });
  // a wrong value is refused before anything is sent
  await form.getByLabel('Monday').fill('17');
  await form.getByRole('button', { name: 'Save working hours' }).click();
  await expect(form.getByText(/up to 16 hours/)).toBeVisible();

  // four hours a day, Monday to Friday, valid since long ago so the current week is covered
  await form.getByLabel('Valid from').fill('2020-01-06');
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await form.getByLabel(day).fill('4');
  }
  await form.getByRole('button', { name: 'Save working hours' }).click();
  await expect(card.getByText('Per week: 20:00 h')).toBeVisible();
  await expect(card.getByText(/In force/)).toBeVisible();

  // capacity measures her against her own hours now
  await page.goto('/capacity');
  await page.getByRole('searchbox').fill('Eva');
  const eva = page
    .getByRole('list', { name: 'Capacity' })
    .getByRole('listitem')
    .filter({ hasText: 'Eva Employee' });
  const text = await eva.innerText();
  // the card shows each figure in its own tile: "Available" above "20:00 h"
  const available = Number(/Available\s+(\d+):\d\d h/.exec(text)?.[1]);
  expect(available).toBeGreaterThan(0);
  expect(available).toBeLessThanOrEqual(20);
});

test('the person sees their hours but cannot change them', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/employees');
  await page
    .getByRole('link', { name: /Eva Employee/ })
    .first()
    .click();
  const card = page.getByRole('heading', { name: 'Working hours' }).locator('..');
  await expect(card.getByText('Per week: 20:00 h')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Change working hours' })).toHaveCount(0);
});
