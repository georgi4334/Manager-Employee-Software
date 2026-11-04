import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

// Workspace settings (docs/adr/0043-workspace-settings.md): the administrator renames the workspace and sees the new
// name at once. Who may not change it is covered by the API tests (the employee of the earlier specs was erased by
// 05-privacy). The name is unique per attempt and always put back, so a retry and later specs see the usual one.
test.use({ viewport: { width: 1280, height: 800 } });

test('the administrator renames the workspace and sees the new name', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  const before = (await (await page.request.get('/api/v1/settings/workspace')).json()) as {
    name: string;
  };
  const renamed = `Acme Europe ${Date.now() % 100_000}`;
  try {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Workspace' })
      .click();
    const form = page.getByRole('form', { name: 'Workspace settings' });
    const name = form.getByLabel('Name', { exact: true });
    await expect(name).toHaveValue(before.name);
    await name.fill(renamed);
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved. The changes apply from now on.')).toBeVisible();

    await page.getByRole('button', { name: 'Profile and settings' }).click();
    await expect(page.getByRole('dialog')).toContainText(renamed);
    await page.keyboard.press('Escape');

    // still the new name after a reload: it was stored, not only shown
    await page.reload();
    await expect(
      page.getByRole('form', { name: 'Workspace settings' }).getByLabel('Name', { exact: true }),
    ).toHaveValue(renamed);
  } finally {
    const restored = await page.request.put('/api/v1/settings/workspace', {
      data: { name: before.name },
    });
    expect(restored.status()).toBe(200);
  }
});
