import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator sees who has time and who is over-booked', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/capacity');
  await expect(page.getByText(/each person's own working hours/)).toBeVisible();

  // Eva is on two projects at 60 % each: over-booked
  const eva = page
    .getByRole('list', { name: 'Capacity' })
    .getByRole('listitem')
    .filter({ hasText: 'Eva Employee' });
  await expect(eva).toContainText('Over-booked');
  await eva.getByText('Days and projects').click();
  await expect(eva.getByRole('list', { name: 'Days of Eva Employee' })).toContainText(
    'Over-booked',
  );
  const projects = eva.getByRole('list', { name: 'Projects of Eva Employee' });
  await expect(projects).toContainText('WEB-1 · Website relaunch');
  await expect(projects).toContainText('API-2 · Public API');

  // the administrator, on no project, is free
  const me = page
    .getByRole('list', { name: 'Capacity' })
    .getByRole('listitem')
    .filter({ hasText: 'Ada Admin' });
  await expect(me).toContainText('Free');

  // filters
  await page.getByRole('searchbox').fill('Eva');
  await expect(page.getByText('1 person')).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'API-2 · Public API' });
  await expect(page.getByText('1 person')).toBeVisible();

  // another week keeps the question simple: the page moves and can come back
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('button', { name: 'This week' })).toBeVisible();
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page.getByRole('button', { name: 'This week' })).toHaveCount(0);
});

test('an employee sees only their own capacity', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/capacity');
  const list = page.getByRole('list', { name: 'Capacity' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Eva Employee');
  await expect(page.getByText('1 person')).toBeVisible();
});
