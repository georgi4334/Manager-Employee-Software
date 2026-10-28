import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';
import { SIGNED_IN } from '../support/pages';

// German has the longest words; no page may scroll sideways on a phone.
test('no page scrolls sideways on a phone in German', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, ADMIN_EMAIL);
  await page.evaluate(() => localStorage.setItem('intime.language', 'de'));
  const wide: string[] = [];
  for (const path of SIGNED_IN) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) wide.push(`${path} (${overflow}px)`);
  }
  expect(wide).toEqual([]);
});
