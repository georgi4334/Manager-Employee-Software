import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

test('an administrator builds the skill catalog', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/skills?tab=catalog');
  const category = page.getByRole('form', { name: 'New category' });
  await category.getByLabel('Category name').fill('Languages');
  await category.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('heading', { name: 'Languages' })).toBeVisible();

  const skill = page.getByRole('form', { name: 'New skill' });
  await skill.getByLabel('Category').selectOption({ label: 'Languages' });
  await skill.getByLabel('Skill name').fill('TypeScript');
  await skill.getByLabel('Description (optional)').fill('Typed JavaScript');
  await skill.getByRole('button', { name: 'Add skill' }).click();
  await expect(page.getByRole('list', { name: 'Languages' })).toContainText('TypeScript');

  // a duplicate name, in another case, is refused with a clear message
  await skill.getByLabel('Skill name').fill('typescript');
  await skill.getByRole('button', { name: 'Add skill' }).click();
  await expect(page.getByText('This name is already in use.')).toBeVisible();
});

test('an employee rates themself and the administrator finds them by skill', async ({
  page,
  browser,
}) => {
  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/skills');
  await expect(eva.getByRole('button', { name: 'Catalog' })).toHaveCount(0);
  await eva.getByLabel('Level of TypeScript').selectOption('4');
  await expect(eva.getByText(/Rated by you on/)).toBeVisible();
  await expect(eva.getByLabel('Level of TypeScript')).toHaveValue('4');

  // she sees only herself in the people list
  await eva.getByRole('button', { name: 'People' }).click();
  await expect(eva.getByText('1 person')).toBeVisible();

  await signIn(page, ADMIN_EMAIL);
  await page.goto('/skills?tab=people');
  await page.getByLabel('Skill', { exact: true }).selectOption({ label: 'TypeScript' });
  await page.getByLabel('Level', { exact: true }).selectOption('3');
  const list = page.getByRole('list', { name: 'People' });
  await expect(list).toContainText('Eva Employee');
  await expect(list).toContainText('TypeScript · Advanced (4/5)');
  await page.getByLabel('Level', { exact: true }).selectOption('5');
  await expect(page.getByText('Nobody matches.')).toBeVisible();
});
