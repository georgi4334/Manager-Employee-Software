import { updateWorkspaceSettingsRequestSchema, type WorkspaceSettings } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { changedRequest, formValues, workspaceFormSchema } from './forms';

const current: WorkspaceSettings = {
  name: 'Acme',
  slug: 'acme',
  timeZone: 'Europe/Sofia',
  language: 'en',
  country: 'BG',
  canEdit: true,
};
const valid = { ...formValues(current) };

describe('workspace settings form', () => {
  it.each([
    ['the current values', valid],
    ['another zone', { ...valid, timeZone: 'America/New_York' }],
    ['UTC', { ...valid, timeZone: 'UTC' }],
    ['no country', { ...valid, country: '' }],
    ['a long name', { ...valid, name: 'x'.repeat(100) }],
  ])('accepts %s, as the API does', (_label, values) => {
    expect(workspaceFormSchema.safeParse(values).success).toBe(true);
    expect(
      updateWorkspaceSettingsRequestSchema.safeParse({
        ...values,
        country: values.country === '' ? null : values.country,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['an empty name', { ...valid, name: '  ' }, 'required'],
    ['a name over 100 characters', { ...valid, name: 'x'.repeat(101) }, 'tooLong'],
    ['an unknown zone', { ...valid, timeZone: 'Mars/Olympus' }, 'invalidTimeZone'],
    ['a bad country', { ...valid, country: 'B1' }, 'invalidCountry'],
  ])('refuses %s, as the API does, with a translated key', (_label, values, key) => {
    const result = workspaceFormSchema.safeParse(values);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(key);
    expect(
      updateWorkspaceSettingsRequestSchema.safeParse({
        ...values,
        country: values.country === '' ? null : values.country,
      }).success,
    ).toBe(false);
  });

  it('sends only what changed, and nothing when nothing did', () => {
    expect(changedRequest(valid, current)).toBeNull();
    expect(changedRequest({ ...valid, name: ' Acme EU ' }, current)).toEqual({ name: 'Acme EU' });
    expect(changedRequest({ ...valid, country: '', language: 'de' }, current)).toEqual({
      language: 'de',
      country: null,
    });
  });
});
