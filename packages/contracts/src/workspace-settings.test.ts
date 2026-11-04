import { describe, expect, it } from 'vitest';
import {
  isTimeZone,
  timeZoneOptions,
  updateWorkspaceSettingsRequestSchema,
  WORKSPACE_NAME_MAX,
} from './workspace-settings.js';

describe('isTimeZone', () => {
  it.each(['Europe/Sofia', 'Europe/Berlin', 'America/Argentina/Buenos_Aires', 'UTC', 'Etc/GMT+2'])(
    'accepts %s',
    (zone) => expect(isTimeZone(zone)).toBe(true),
  );

  it.each(['', 'Sofia', 'Europe/Atlantis', '+02:00', 'UTC+2', 'europe/sofia ', '../etc/passwd'])(
    'refuses %j',
    (zone) => expect(isTimeZone(zone)).toBe(false),
  );
});

describe('timeZoneOptions', () => {
  it('starts with UTC, is sorted and keeps the current zone', () => {
    const zones = timeZoneOptions('Europe/Sofia');
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Europe/Sofia');
    expect(zones.slice(1)).toEqual([...zones.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('updateWorkspaceSettingsRequestSchema', () => {
  const parse = (v: unknown) => updateWorkspaceSettingsRequestSchema.safeParse(v);

  it('accepts any subset and normalises the values', () => {
    expect(parse({ name: '  Acme GmbH  ' }).data).toEqual({ name: 'Acme GmbH' });
    expect(parse({ timeZone: 'Europe/Berlin', language: 'de', country: 'de' }).data).toEqual({
      timeZone: 'Europe/Berlin',
      language: 'de',
      country: 'DE',
    });
    expect(parse({ country: null }).data).toEqual({ country: null });
    expect(parse({ name: 'x'.repeat(WORKSPACE_NAME_MAX) }).success).toBe(true);
  });

  it.each([
    ['nothing', {}],
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(WORKSPACE_NAME_MAX + 1) }],
    ['an unknown zone', { timeZone: 'Mars/Olympus' }],
    ['an offset', { timeZone: '+02:00' }],
    ['another language', { language: 'fr' }],
    ['a three-letter country', { country: 'BGR' }],
    ['the slug', { slug: 'other' }],
    ['an unknown field', { name: 'A', logo: 'x' }],
  ])('refuses %s', (_label, value) => {
    expect(parse(value).success).toBe(false);
  });

  it('uses message keys the web app translates', () => {
    const issues = (v: unknown) => parse(v).error?.issues.map((i) => i.message);
    expect(issues({ timeZone: 'Mars/Olympus' })).toEqual(['invalidTimeZone']);
    expect(issues({ name: '' })).toEqual(['required']);
    expect(issues({ country: 'B1' })).toEqual(['invalidCountry']);
  });
});
