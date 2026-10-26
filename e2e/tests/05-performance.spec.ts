import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL, EMPLOYEE_EMAIL } from '../support/constants';

const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('HR opens a review cycle and the employee writes the self-review', async ({
  page,
  browser,
}) => {
  await signIn(page, ADMIN_EMAIL);
  // the administrator is Eva's manager
  const people = (await (await page.request.get('/api/v1/employees?pageSize=100')).json()) as {
    items: { id: string; firstName: string }[];
  };
  const id = (name: string) => people.items.find((p) => p.firstName === name)!.id;
  const set = await page.request.put(`/api/v1/org/employees/${id('Eva')}/assignment`, {
    data: { managerId: id('Ada'), departmentId: null },
  });
  expect(set.status()).toBe(204);

  await page.goto('/reviews?tab=cycles');
  await page.getByRole('button', { name: 'New cycle' }).click();
  const form = page.getByRole('form', { name: 'New review cycle' });
  await form.getByLabel('Name').fill('Mid-year 2026');
  await form.getByLabel('Period starts').fill('2026-01-01');
  await form.getByLabel('Period ends').fill('2026-06-30');
  await form.getByLabel('Self-reviews due').fill(inDays(14));
  await form.getByLabel('Manager reviews due').fill(inDays(28));
  await form.getByRole('button', { name: 'Create' }).click();

  for (const name of ['Teamwork', 'Delivery']) {
    const add = page.getByRole('form', { name: 'New competency' });
    await add.getByLabel('Competency').fill(name);
    await add.getByRole('button', { name: 'Add competency' }).click();
    await expect(page.getByRole('list', { name: 'Competencies of Mid-year 2026' })).toContainText(
      name,
    );
  }
  await page.getByRole('button', { name: 'Open Mid-year 2026' }).click();
  await page
    .getByRole('button', { name: 'Yes, open it and create a review for everybody' })
    .click();
  await expect(page.getByText(/self-reviews and 0 manager reviews submitted/)).toBeVisible();

  const eva = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/reviews');
  await eva.getByRole('link', { name: 'Mid-year 2026' }).click();
  const self = eva.getByRole('form', { name: 'Write your self-review' });
  // an incomplete self-review cannot be submitted
  await self.getByLabel('Score for Teamwork').selectOption('4');
  await self.getByRole('button', { name: 'Submit' }).click();
  await expect(self.getByText('Give every competency a score before you submit.')).toBeVisible();
  await self.getByLabel('Score for Delivery').selectOption('3');
  await self.getByLabel('Comment on Delivery (optional)').fill('Shipped the relaunch');
  await self.getByLabel('Summary (optional)').fill('A good half year');
  await self.getByRole('button', { name: 'Submit' }).click();
  await expect(eva.getByText('Shipped the relaunch')).toBeVisible();
  await expect(
    eva.getByText('The manager review is shown here once the results are released.'),
  ).toBeVisible();
});

test('the manager reviews, HR calibrates and releases, and the employee reads the result', async ({
  page,
  browser,
}) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/reviews?tab=team');
  await page.getByRole('link', { name: /Eva Employee · Mid-year 2026/ }).click();
  await expect(page.getByText('A good half year')).toBeVisible();
  const manager = page.getByRole('form', { name: 'Write the manager review' });
  await manager.getByLabel('Score for Teamwork').selectOption('5');
  await manager.getByLabel('Score for Delivery').selectOption('4');
  await manager.getByLabel('Summary (optional)').fill('Reliable and growing');
  await manager.getByLabel('Overall rating').selectOption('4');
  await manager.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Reliable and growing')).toBeVisible();
  await expect(page.getByText('Overall rating: 4 of 5')).toBeVisible();

  await page.goto('/reviews?tab=cycles');
  await page.getByRole('button', { name: 'Start calibration of Mid-year 2026' }).click();
  await page.getByRole('button', { name: 'Yes, stop writing and start calibration' }).click();
  await page.getByRole('button', { name: 'Show the reviews of Mid-year 2026' }).click();
  await page.getByRole('link', { name: /Eva Employee · Mid-year 2026/ }).click();
  const calibration = page.getByRole('form', { name: 'Calibration' });
  await calibration.getByLabel('Calibrated rating').selectOption('5');
  await calibration.getByRole('button', { name: 'Save calibration' }).click();
  await expect(page.getByText('Final rating: 5 of 5 (Outstanding)')).toBeVisible();

  await page.goto('/reviews?tab=cycles');
  await page.getByRole('button', { name: 'Close Mid-year 2026 and release results' }).click();
  await page.getByRole('button', { name: 'Yes, close it and release the results' }).click();
  await expect(page.getByText('Closed').first()).toBeVisible();

  const eva = await (await browser.newContext()).newPage();
  await signIn(eva, EMPLOYEE_EMAIL);
  await eva.goto('/reviews');
  await eva.getByRole('link', { name: 'Mid-year 2026' }).click();
  await expect(eva.getByText('Final rating: 5 of 5 (Outstanding)')).toBeVisible();
  await expect(eva.getByText('Reliable and growing')).toBeVisible();
  await expect(eva.getByText('Written by Ada Admin')).toBeVisible();
  // the calibration itself stays with HR
  await expect(eva.getByRole('form', { name: 'Calibration' })).toHaveCount(0);
});
