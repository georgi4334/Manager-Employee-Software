import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

// The collapsible side menu (docs/adr/0042-collapsible-sidebar.md): an icon rail that is remembered.
test.use({ viewport: { width: 1280, height: 800 } });

test('the side menu collapses to icons, keeps working and is remembered', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  const menu = page.getByRole('navigation', { name: 'Main navigation' });
  const aside = page.locator('aside');
  const wide = (await aside.boundingBox())!.width;

  await page.getByRole('button', { name: 'Collapse menu' }).click();
  await expect(aside).toHaveAttribute('data-collapsed', 'true');
  const narrow = (await aside.boundingBox())!.width;
  expect(narrow).toBeLessThan(100);
  expect(narrow).toBeLessThan(wide);

  // the label shows beside the icon, and the entry still navigates
  await menu.getByRole('link', { name: 'Leave', exact: true }).hover();
  await expect(page.locator('[data-rail-tip]')).toHaveText('Leave');
  await menu.getByRole('link', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Leave' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand menu' }).click();
  await expect(aside).not.toHaveAttribute('data-collapsed', 'true');
  await expect(menu.getByRole('link', { name: 'Leave', exact: true })).toContainText('Leave');
});
