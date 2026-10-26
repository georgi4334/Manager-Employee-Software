import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

// No spec sends a question: the assistant would call a real AI provider.

test('the assistant is off until an administrator switches it on and adds a workspace key', async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/assistant');
  await expect(page.getByText(/switched off for your workspace/)).toBeVisible();

  await page.goto('/assistant?tab=settings');
  await page.getByRole('checkbox', { name: 'Switch the assistant on for this workspace' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Switch the assistant on for this workspace' }),
  ).toBeChecked();

  // the key form refuses a short key before anything is sent
  const form = page.getByRole('form', { name: 'Workspace key' });
  await form.getByLabel('Model').fill('llama-3.3-70b-versatile');
  await form.getByLabel('Key').fill('short');
  await form.getByRole('button', { name: 'Store key' }).click();
  await expect(form.getByText(/at least 8 characters/)).toBeVisible();

  await form.getByLabel('Key').fill('gsk_e2e-not-a-real-key-4242');
  await form.getByRole('button', { name: 'Store key' }).click();
  await expect(page.getByText(/key ending in 4242/)).toBeVisible();
  // the key itself never comes back
  await expect(page.getByText('gsk_e2e-not-a-real-key')).toHaveCount(0);
  await expect(form.getByLabel('Key')).toHaveValue('');

  // consent: the administrator accepts the notice, then the chat is ready
  await page.getByRole('button', { name: 'Accept and save' }).click();
  await expect(page.getByText('You accepted the notice.')).toBeVisible();
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByLabel('Your question')).toBeVisible();
});

test('an employee must accept the notice before asking; then the workspace key is used', async ({
  page,
}) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/assistant');
  await expect(page.getByText(/read and accept the notice/)).toBeVisible();
  await page.getByRole('button', { name: 'Open settings' }).click();

  // no workspace controls and no workspace key for employees
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expect(page.getByText('gsk_e2e')).toHaveCount(0);

  const share = page.getByRole('checkbox', { name: /look up other people/ });
  await expect(share).not.toBeChecked();
  await page.getByRole('button', { name: 'Accept and save' }).click();
  await expect(page.getByText('You accepted the notice.')).toBeVisible();

  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByLabel('Your question')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
});
