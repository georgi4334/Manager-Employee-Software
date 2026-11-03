import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

// Onboarding checklists (docs/adr/0040-onboarding-checklists.md): a template, a checklist for Eva, steps ticked by
// the HR group and by Eva herself.
test('HR builds a template, starts it for a person, and both tick their steps', async ({
  browser,
}) => {
  const ada = await (await browser.newContext()).newPage();
  await signIn(ada, ADMIN_EMAIL);
  await ada.goto('/checklists/templates/new');
  await ada.getByLabel('Name').fill('Welcome');
  await ada.getByLabel('Title').fill('Order a laptop');
  await ada.getByRole('button', { name: 'Add a step' }).click();
  await ada.getByLabel('Title').nth(1).fill('Read the handbook');
  await ada.getByLabel('Who does it').nth(1).selectOption({ label: 'The person' });
  await ada.getByLabel('Days from the date').nth(1).fill('3');
  await ada.getByRole('button', { name: 'Save template' }).click();
  const templates = ada.getByRole('main').getByRole('list', { name: 'Templates' });
  await expect(templates.getByRole('link', { name: 'Welcome' })).toBeVisible();

  await ada.goto('/checklists?tab=people');
  await ada.getByRole('button', { name: 'Start a checklist' }).click();
  await ada.getByLabel('Person').selectOption({ label: 'Eva Employee' });
  await ada.getByLabel('Template').selectOption({ label: 'Welcome (Onboarding)' });
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  const people = ada.getByRole('main').getByRole('list', { name: 'People' });
  await expect(people.getByRole('link', { name: 'Eva Employee' })).toBeVisible();
  await expect(people).toContainText('0 of 2 done');

  // the HR step waits for the administrator (HR group)
  await ada.goto('/checklists');
  const mine = ada.getByRole('main').getByRole('list', { name: 'My to-dos' });
  await mine.getByRole('checkbox', { name: 'Mark “Order a laptop” as done' }).click();
  await expect(ada.getByText('Nothing is waiting for you.')).toBeVisible();

  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/checklists');
  await eva.getByRole('checkbox', { name: 'Mark “Read the handbook” as done' }).click();
  await expect(eva.getByText('Nothing is waiting for you.')).toBeVisible();

  await ada.goto('/checklists?tab=people');
  await ada.getByLabel('Status').selectOption({ label: 'Done' });
  await expect(
    ada.getByRole('main').getByRole('list', { name: 'People' }).getByText('2 of 2 done'),
  ).toBeVisible();
});
