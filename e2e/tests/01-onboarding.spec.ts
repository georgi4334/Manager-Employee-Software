import { expect, test } from '@playwright/test';
import { acceptInvitation, signIn } from '../support/auth';
import { ADMIN_EMAIL, PASSWORD } from '../support/constants';
import { adminInvitation } from '../support/mail';

test.describe('first administrator', () => {
  test('accepts the invitation, chooses a password and lands signed in', async ({ page }) => {
    await acceptInvitation(page, adminInvitation());
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('cannot use the invitation link twice', async ({ page }) => {
    await page.goto(adminInvitation());
    await expect(page.getByText('This invitation cannot be used')).toBeVisible();
  });

  test('signs in, signs out, and is refused with a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(`${PASSWORD} wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, ADMIN_EMAIL);
    await page.getByRole('button', { name: 'Profile and settings' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/leave');
    await expect(page).toHaveURL(/\/login/); // signed-out visitors are sent to sign in
  });

  test('keeps the chosen language after a reload', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.getByRole('button', { name: 'Profile and settings' }).click();
    await page.getByLabel('Language').selectOption({ label: 'Deutsch' });
    await expect(page.getByRole('button', { name: 'Profil und Einstellungen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    await page.getByRole('button', { name: 'Profil und Einstellungen' }).click();
    await page.getByLabel('Sprache').selectOption({ label: 'English' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
