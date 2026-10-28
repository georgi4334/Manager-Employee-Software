import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator sees the management view and can change the period', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();

  for (const name of [
    'People',
    'Absence',
    'Attendance',
    'Time on projects',
    'Projects and tasks',
  ]) {
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  // company-wide sections belong to the administrator
  await expect(page.getByRole('heading', { name: 'Company', level: 2 })).toBeVisible();

  // the workspace has the signed-in administrator and more people: a number, not a dash
  const people = page.getByRole('region', { name: 'People' });
  await expect(people.getByText('Active people')).toBeVisible();

  const projects = page.getByRole('region', { name: 'Projects and tasks' });
  await expect(projects.getByText('Open tasks')).toBeVisible();

  const period = page.getByRole('group', { name: 'Period' });
  await period.getByRole('button', { name: 'Last 90 days' }).click();
  await expect(period.getByRole('button', { name: 'Last 90 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(people.getByText('Active people')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
});

test('an employee has no access to analytics', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await page.goto('/analytics');
  await expect(page.getByText('No access')).toBeVisible();
});
