import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function newProject(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const form = page.getByRole('form', { name: 'New project' });
  await form.getByLabel('Code').fill(code);
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Status').selectOption({ label: 'Active' });
  await form.getByLabel('Start date').fill(iso(-30));
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('an administrator sets up a client and a project and staffs an employee', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);

  await page.goto('/projects?tab=clients');
  await page.getByRole('button', { name: 'Add client' }).click();
  const clientForm = page.getByRole('form', { name: 'Add client' });
  await clientForm.getByLabel('Name').fill('Initech');
  await clientForm.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Clients' }).getByText('Initech')).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByRole('form', { name: 'Add client' }).getByLabel('Name').fill('initech');
  await page
    .getByRole('form', { name: 'Add client' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByText('A client with this name already exists.')).toBeVisible();

  await newProject(page, 'web-1', 'Website relaunch');
  await expect(page.getByText('WEB-1')).toBeVisible();
  await expect(page.getByText('On track').first()).toBeVisible();

  // a milestone that is overdue puts the project at risk
  await page.getByRole('button', { name: 'Add milestone' }).click();
  const milestone = page.getByRole('form', { name: 'Add milestone' });
  await milestone.getByLabel('Milestone').fill('Design approved');
  await milestone.getByLabel('Due date').fill(iso(-3));
  await milestone.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('3 days overdue')).toBeVisible();
  await expect(page.getByText('At risk').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await expect(page.getByText('On track').first()).toBeVisible();

  // staff Eva, and refuse the same person in the same period
  await page.getByRole('button', { name: 'Add person' }).click();
  const team = page.getByRole('form', { name: 'Add person' });
  await team.getByLabel('Search for Person').fill('Eva');
  await expect(team.getByRole('option', { name: 'Eva Employee' })).toBeAttached();
  await team.getByLabel('Person', { exact: true }).selectOption({ label: 'Eva Employee' });
  await team.getByLabel('Role (optional)').fill('Frontend');
  await team.getByLabel('Allocation (%)').fill('60');
  await team.getByLabel('From').fill(iso(-10));
  await team.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Frontend · 60% of their time')).toBeVisible();
  await page.getByRole('button', { name: 'Add person' }).click();
  const again = page.getByRole('form', { name: 'Add person' });
  await again.getByLabel('Search for Person').fill('Eva');
  await expect(again.getByRole('option', { name: 'Eva Employee' })).toBeAttached();
  await again.getByLabel('Person', { exact: true }).selectOption({ label: 'Eva Employee' });
  await again.getByLabel('From').fill(iso(-5));
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('This person is already on the project in this period.'),
  ).toBeVisible();

  // a second project at 60 % makes Eva over-allocated
  await newProject(page, 'api-2', 'Public API');
  await page.getByRole('button', { name: 'Add person' }).click();
  const second = page.getByRole('form', { name: 'Add person' });
  await second.getByLabel('Search for Person').fill('Eva');
  await expect(second.getByRole('option', { name: 'Eva Employee' })).toBeAttached();
  await second.getByLabel('Person', { exact: true }).selectOption({ label: 'Eva Employee' });
  await second.getByLabel('Allocation (%)').fill('60');
  await second.getByLabel('From').fill(iso(-5));
  await second.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Over-allocated')).toBeVisible();
});

test('the employee sees her projects, is told, and cannot change anything', async ({ page }) => {
  await signIn(page, EMPLOYEE_EMAIL);
  await page.goto('/projects');
  await expect(page.getByRole('tablist')).toHaveCount(0); // no clients tab
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  const list = page.getByRole('list', { name: 'Projects' });
  await expect(list.getByText('Website relaunch')).toBeVisible();
  await expect(list.getByText('Public API')).toBeVisible();
  await expect(list.getByText('Initech')).toHaveCount(0); // the client is hidden from her

  await list.getByText('Website relaunch').click();
  await expect(page.getByRole('heading', { name: 'Website relaunch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0);
  await expect(page.getByText('Over-allocated')).toBeVisible();

  await page.goto('/notifications');
  await expect(page.getByText(/You were added to the project/).first()).toBeVisible();
});
