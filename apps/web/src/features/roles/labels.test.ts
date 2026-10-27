import { PERMISSIONS, PERMISSION_MODULES, PERMISSION_SCOPES } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import bg from '@/i18n/locales/bg/roles.json';
import de from '@/i18n/locales/de/roles.json';
import en from '@/i18n/locales/en/roles.json';

/** A new permission, module or scope in the catalog must come with a text in every language (ADR 0031). */
describe.each([
  ['en', en],
  ['de', de],
  ['bg', bg],
])('role editor texts (%s)', (_language, texts) => {
  it('has a label for every permission, and none for permissions that do not exist', () => {
    const codes = PERMISSIONS.map((p) => p.code).sort();
    expect(Object.keys(texts.permissions).sort()).toEqual(codes);
    for (const label of Object.values(texts.permissions))
      expect(label.trim().length).toBeGreaterThan(2);
  });

  it('has a name for every module and every scope', () => {
    expect(Object.keys(texts.modules).sort()).toEqual([...PERMISSION_MODULES].sort());
    expect(Object.keys(texts.scopes).sort()).toEqual([...PERMISSION_SCOPES].sort());
  });

  it('gives each permission its own label', () => {
    const labels = Object.values(texts.permissions);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
