import { expect, test, type Locator } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

// The other specs run with reduced motion; these ones check that the motion itself happens.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const transformOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).transform);

test('the profile drawer slides in and out instead of jumping', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  const drawer = page.getByRole('dialog', { name: /@/ });
  await drawer.waitFor();
  // right after it appears it is still on its way in from the right edge
  expect(await transformOf(drawer)).not.toBe('none');
  await expect.poll(() => transformOf(drawer), { timeout: 3000 }).toBe('none');

  await page.getByRole('button', { name: 'Close' }).click();
  // it stays for the exit and then leaves the page
  await expect(drawer).toHaveCount(0, { timeout: 3000 });
});

test('the tab highlight glides to the chosen tab', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/leave');
  const list = page.getByRole('tablist').first();
  const thumb = list.locator('span[aria-hidden="true"]');
  await thumb.waitFor();
  const before = await transformOf(thumb);
  const second = list.getByRole('tab').nth(1);
  await second.click();
  await expect.poll(() => transformOf(thumb), { timeout: 3000 }).not.toBe(before);
  // it ends exactly under the chosen tab
  const left = await second.evaluate((element) => (element as HTMLElement).offsetLeft);
  await expect
    .poll(() => transformOf(thumb), { timeout: 3000 })
    .toBe(`matrix(1, 0, 0, 1, ${left}, 0)`);
  await expect(list.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('a new page glides in', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: /Mobile navigation|Main navigation/ })
    .getByRole('link', { name: 'Leave' })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('main > .motion-route').count()).toBe(1);
});

test('the phone menu sheet rises and lowers', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/');
  await page.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'More navigation' });
  await sheet.waitFor();
  expect(await transformOf(sheet)).not.toBe('none');
  await expect.poll(() => transformOf(sheet), { timeout: 3000 }).toBe('none');
  await page.getByRole('button', { name: 'More' }).click();
  await expect(sheet).toHaveCount(0, { timeout: 3000 });
});
