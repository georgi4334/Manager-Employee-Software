import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/auth';
import { ADMIN_EMAIL } from '../support/constants';

// WCAG 2.1 A and AA, as far as an automated scan can judge (contrast, names, roles, landmarks, labels).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SIGNED_OUT = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation?token=invalid',
];
const SIGNED_IN = [
  '/',
  '/employees',
  '/employees/new',
  '/organization',
  '/leave',
  '/leave?tab=approvals',
  '/leave?tab=team',
  '/leave?tab=settings',
  '/attendance',
  '/attendance?tab=history',
  '/attendance?tab=team',
  '/calendar?view=month',
  '/calendar?view=week',
  '/calendar?view=day',
  '/calendar?view=agenda',
  '/notifications',
  '/notifications/settings',
  '/projects',
  '/projects?tab=clients',
  '/tasks',
  '/tasks?view=board',
  '/time',
  '/time?tab=approvals',
  '/time?tab=reports',
  '/capacity',
  '/analytics',
  '/assistant',
  '/assistant?tab=settings',
  '/goals',
  '/goals?scope=personal',
  '/one-on-ones',
  '/one-on-ones?status=all',
  '/feedback',
  '/feedback?box=given',
  '/skills',
  '/skills?tab=people',
  '/skills?tab=catalog',
  '/reviews',
  '/reviews?tab=team',
  '/reviews?tab=cycles',
  '/profile',
  '/does-not-exist',
];

/** Earlier specs erase the employee of the 1:1 spec, so the scan makes sure there is one meeting to open. */
async function ensureMeeting(page: Page): Promise<void> {
  const api = '/api/v1';
  const existing = await (await page.request.get(`${api}/one-on-ones?status=all`)).json();
  if (existing.total > 0) return;
  const created = await page.request.post(`${api}/employees`, {
    data: { firstName: 'Olga', lastName: 'Scan', employmentType: 'full_time' },
  });
  const olga = (await created.json()) as { id: string };
  const me = (await (await page.request.get(`${api}/employees/me`)).json()) as { id: string };
  expect(
    (
      await page.request.put(`${api}/org/employees/${olga.id}/assignment`, {
        data: { managerId: me.id, departmentId: null },
      })
    ).status(),
  ).toBe(204);
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 5);
  const made = await page.request.post(`${api}/one-on-ones`, {
    data: { employeeId: olga.id, date: day.toISOString().slice(0, 10), time: '09:00' },
  });
  expect(made.status()).toBe(201);
}

async function scan(page: Page, label: string): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map(
    (v) =>
      `${label} · ${v.id} (${v.impact}): ${v.help} · ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const variants = [
  { name: 'phone, light', viewport: { width: 375, height: 800 }, colorScheme: 'light' as const },
  { name: 'phone, dark', viewport: { width: 375, height: 800 }, colorScheme: 'dark' as const },
  { name: 'desktop, light', viewport: { width: 1280, height: 800 }, colorScheme: 'light' as const },
  { name: 'desktop, dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const },
];

for (const variant of variants) {
  test.describe(`accessibility: ${variant.name}`, () => {
    test.use({ viewport: variant.viewport, colorScheme: variant.colorScheme });

    test('signed-out pages have no WCAG A/AA violations', async ({ page }) => {
      const found: string[] = [];
      for (const path of SIGNED_OUT) {
        await settle(page, path);
        found.push(...(await scan(page, path)));
      }
      expect(found).toEqual([]);
    });

    test('signed-in pages have no WCAG A/AA violations', async ({ page }) => {
      test.setTimeout(240_000); // about twenty pages, each loaded and scanned
      await signIn(page, ADMIN_EMAIL);
      const found: string[] = [];
      for (const path of SIGNED_IN) {
        await settle(page, path);
        found.push(...(await scan(page, path)));
      }
      // forms and panels that only exist after an action
      await settle(page, '/calendar?view=agenda');
      await page.getByRole('button', { name: 'New event' }).click();
      found.push(...(await scan(page, '/calendar (new event form)')));
      await settle(page, '/attendance');
      await page.getByRole('button', { name: 'Add a period' }).click();
      found.push(...(await scan(page, '/attendance (period form)')));
      await settle(page, '/employees');
      await page.locator('main a[href^="/employees/"]').first().click(); // a person, not the nav entry
      await page.waitForLoadState('networkidle');
      found.push(...(await scan(page, 'employee detail')));
      await settle(page, '/projects');
      await page.getByRole('button', { name: 'New project' }).click();
      found.push(...(await scan(page, '/projects (new project form)')));
      await settle(page, '/projects');
      await page.locator('main a[href^="/projects/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Add person' }).click();
      await page.getByRole('button', { name: 'Add milestone' }).click();
      found.push(...(await scan(page, 'project detail (forms open)')));
      await settle(page, '/tasks');
      await page.getByRole('button', { name: 'New task' }).click();
      found.push(...(await scan(page, '/tasks (new task form)')));
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Edit' }).first().click();
      found.push(...(await scan(page, '/tasks (edit form)')));
      await settle(page, '/time');
      await page.getByRole('button', { name: 'Add time' }).click();
      found.push(...(await scan(page, '/time (add time form)')));
      await page.getByRole('button', { name: 'Compare with attendance' }).click();
      found.push(...(await scan(page, '/time (comparison open)')));
      await settle(page, '/capacity');
      await page.getByText('Days and projects').first().click();
      found.push(...(await scan(page, '/capacity (days and projects open)')));
      await settle(page, '/goals');
      await page.getByRole('button', { name: 'New goal' }).click();
      found.push(...(await scan(page, '/goals (new goal form)')));
      await settle(page, '/goals');
      await page.locator('main a[href^="/goals/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Add a key result' }).click();
      found.push(...(await scan(page, 'goal detail (key result form open)')));
      await ensureMeeting(page);
      await settle(page, '/one-on-ones');
      await page.getByRole('button', { name: 'Schedule a 1:1' }).click();
      found.push(...(await scan(page, '/one-on-ones (schedule form)')));
      await settle(page, '/one-on-ones?status=all');
      await page.locator('main a[href^="/one-on-ones/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Change the time' }).click();
      found.push(...(await scan(page, '1:1 detail (time form open)')));
      await settle(page, '/feedback');
      await page.getByRole('button', { name: 'Give feedback' }).click();
      found.push(...(await scan(page, '/feedback (give form)')));
      await settle(page, '/skills?tab=people');
      await page
        .getByRole('button', { name: /^Edit the skills of/ })
        .first()
        .click();
      found.push(...(await scan(page, '/skills (people, editor open)')));
      await settle(page, '/reviews');
      await page.locator('main a[href^="/reviews/"]').first().click();
      await page.waitForLoadState('networkidle');
      found.push(...(await scan(page, '/reviews/:id (own review, editor open)')));
      await settle(page, '/leave?tab=approvals');
      await page
        .getByRole('button', { name: /^Check the project impact/ })
        .first()
        .click();
      found.push(...(await scan(page, '/leave approvals (project impact open)')));
      expect(found).toEqual([]);
    });
  });
}
