import { describe, expect, it } from 'vitest';
import {
  budgetUsage,
  exportQuerySchema,
  reportQuerySchema,
  timeExportCsv,
  type ExportRow,
} from './time-reports.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

describe('report queries', () => {
  const ok = { from: '2026-10-01', to: '2026-10-31', groupBy: 'project' };
  it('accepts a period and a grouping', () => {
    expect(reportQuerySchema.safeParse(ok).success).toBe(true);
    expect(reportQuerySchema.safeParse({ ...ok, projectId: ID, groupBy: 'person' }).success).toBe(
      true,
    );
  });
  it.each([
    ['no grouping', { groupBy: undefined }],
    ['an unknown grouping', { groupBy: 'team' }],
    ['no start', { from: undefined }],
    ['a bad date', { to: '31.10.2026' }],
    ['an end before the start', { to: '2026-09-30' }],
    ['more than a year', { from: '2025-01-01', to: '2026-10-31' }],
    ['a bad project id', { projectId: 'x' }],
  ])('refuses %s', (_label, patch) => {
    expect(reportQuerySchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it('boundaries: one day, and exactly 366 days', () => {
    expect(
      reportQuerySchema.safeParse({ ...ok, from: '2026-10-01', to: '2026-10-01' }).success,
    ).toBe(true);
    expect(
      reportQuerySchema.safeParse({ ...ok, from: '2025-10-01', to: '2026-09-30' }).success,
    ).toBe(true); // 365 days
    expect(
      reportQuerySchema.safeParse({ ...ok, from: '2025-10-01', to: '2026-10-01' }).success,
    ).toBe(true); // 366 days
    expect(
      reportQuerySchema.safeParse({ ...ok, from: '2025-10-01', to: '2026-10-02' }).success,
    ).toBe(false); // 367 days
  });
  it('the export takes the same period without a grouping', () => {
    expect(exportQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(
      true,
    );
    expect(exportQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(
      false,
    );
  });
});

describe('budgetUsage', () => {
  it('has nothing to say without a budget', () => {
    expect(budgetUsage(100, null)).toBeNull();
    expect(budgetUsage(100, 0)).toBeNull();
  });
  it.each([
    [0, 600, 0, 'ok'],
    [479, 600, 80, 'ok'], // 79.8 % rounds to 80 but is still under
    [480, 600, 80, 'warning'],
    [600, 600, 100, 'warning'], // exactly the budget is not over
    [601, 600, 100, 'over'],
    [1200, 600, 200, 'over'],
  ])('%i of %i minutes → %i %% (%s)', (logged, budget, percent, level) => {
    const usage = budgetUsage(logged, budget)!;
    expect(usage.level).toBe(level);
    expect(usage.percent).toBe(percent);
  });
});

describe('timeExportCsv', () => {
  const row = (o: Partial<ExportRow> = {}): ExportRow => ({
    workDate: '2026-10-26',
    person: 'Eva Employee',
    projectCode: 'WEB-1',
    projectName: 'Website',
    task: 'WEB-1-3',
    minutes: 90,
    isBillable: true,
    ...o,
  });
  it('writes a header and one line per entry, hours with a dot', () => {
    expect(timeExportCsv([row(), row({ minutes: 20, task: null, isBillable: false })])).toBe(
      'date,person,project_code,project_name,task,hours,billable\r\n' +
        '2026-10-26,Eva Employee,WEB-1,Website,WEB-1-3,1.50,yes\r\n' +
        '2026-10-26,Eva Employee,WEB-1,Website,,0.33,no\r\n',
    );
  });
  it('writes just the header for no entries', () => {
    expect(timeExportCsv([])).toBe('date,person,project_code,project_name,task,hours,billable\r\n');
  });
  it('quotes commas, quotes and line breaks', () => {
    const csv = timeExportCsv([row({ projectName: 'A, "B"\nC' })]);
    expect(csv).toContain('"A, ""B""\nC"');
  });
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd'])('neutralises the formula %j', (name) => {
    const csv = timeExportCsv([row({ person: name })]);
    expect(csv.split('\r\n')[1]!.split(',')[1]).toBe(`'${name}`);
  });
  it('rounds minutes to two decimal hours', () => {
    expect(timeExportCsv([row({ minutes: 1 })])).toContain(',0.02,');
    expect(timeExportCsv([row({ minutes: 960 })])).toContain(',16.00,');
  });
});
