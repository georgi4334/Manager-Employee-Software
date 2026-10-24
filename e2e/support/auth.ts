import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './constants';

/** Opens an invitation link and chooses the password. */
export async function acceptInvitation(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}
