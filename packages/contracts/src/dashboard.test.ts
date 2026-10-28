import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD,
  MAX_DASHBOARD_WIDGETS,
  dashboardLayoutRequestSchema,
  moveWidget,
  normalizeLayout,
} from './dashboard.js';

describe('dashboard layout request', () => {
  it('accepts known widgets in any order, and an empty dashboard', () => {
    expect(
      dashboardLayoutRequestSchema.safeParse({ widgets: ['tasks', 'stat_hours'] }).success,
    ).toBe(true);
    expect(dashboardLayoutRequestSchema.safeParse({ widgets: [] }).success).toBe(true);
    expect(
      dashboardLayoutRequestSchema.safeParse({ widgets: [...DASHBOARD_WIDGETS] }).success,
    ).toBe(true);
  });
  it.each([
    ['an unknown widget', { widgets: ['tasks', 'payroll'] }],
    ['a widget twice', { widgets: ['tasks', 'tasks'] }],
    ['no list', {}],
    ['a list that is not strings', { widgets: [1] }],
  ])('refuses %s', (_name, body) => {
    expect(dashboardLayoutRequestSchema.safeParse(body).success).toBe(false);
  });
  it('the catalog fits the limit and the default uses known widgets only', () => {
    expect(DASHBOARD_WIDGETS.length).toBeLessThanOrEqual(MAX_DASHBOARD_WIDGETS);
    expect(normalizeLayout(DEFAULT_DASHBOARD)).toEqual(DEFAULT_DASHBOARD);
  });
});

describe('normalizeLayout', () => {
  it('drops unknown and repeated ids and keeps the order', () => {
    expect(normalizeLayout(['tasks', 'gone', 'time', 'tasks'])).toEqual(['tasks', 'time']);
  });
});

describe('moveWidget', () => {
  const list = ['a', 'b', 'c'];
  it('moves up and down', () => {
    expect(moveWidget(list, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveWidget(list, 1, 1)).toEqual(['a', 'c', 'b']);
  });
  it('changes nothing at the edges or out of range', () => {
    expect(moveWidget(list, 0, -1)).toEqual(list);
    expect(moveWidget(list, 2, 1)).toEqual(list);
    expect(moveWidget(list, 5, -1)).toEqual(list);
  });
  it('does not change the original list', () => {
    moveWidget(list, 0, 1);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
