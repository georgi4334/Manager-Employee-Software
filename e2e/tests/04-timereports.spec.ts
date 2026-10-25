import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

test('an administrator reads the hours per project and person and exports the approved ones', async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/time?tab=reports');

  // per project: Eva's approved week
  const projects = page.getByRole('list', { name: 'Reports' });
  const website = projects.getByRole('listitem').filter({ hasText: 'Website relaunch' });
  await expect(website).toBeVisible();
  await expect(website).toContainText('WEB-1');
  await expect(website).toContainText(/Billable 1:3\d h · approved 1:3\d h/);

  // per person
  await page.getByLabel('Group by').selectOption({ label: 'Person' });
  await expect(projects.getByRole('listitem').filter({ hasText: 'Eva Employee' })).toBeVisible();

  // a period that ends before it starts is explained, not requested
  await page.getByLabel('To', { exact: true }).fill('2000-01-01');
  await expect(page.getByText('The end cannot be before the start.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export approved hours (CSV)' })).toBeDisabled();
  await page.getByLabel('To', { exact: true }).fill(new Date().toISOString().slice(0, 10));

  // the CSV holds the approved hours with names, but no notes
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved hours (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^approved-hours-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('date,person,project_code,project_name,task,hours,billable');
  expect(csv).toContain('Eva Employee,WEB-1,Website relaunch');
  expect(csv).not.toContain('Design review');
  await expect(page.getByText(/File saved with \d+ lines\./)).toBeVisible();
});
