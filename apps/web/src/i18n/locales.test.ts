import { describe, expect, it } from 'vitest';
import { resources } from '@/tests/i18n';
import { LANGUAGES, NAMESPACES } from './languages';
import { compareTranslations, type TranslationTree } from './validate';

/** Fails the build when a translation is missing, empty, extra or has different placeholders. */
describe('translation files', () => {
  it.each(LANGUAGES)('%s has every namespace', (language) => {
    expect(Object.keys(resources[language] ?? {}).sort()).toEqual([...NAMESPACES].sort());
  });

  const others = LANGUAGES.filter((language) => language !== 'en');
  describe.each(others)('%s is in sync with English', (language) => {
    it.each(NAMESPACES)('namespace %s', (namespace) => {
      const reference = resources.en?.[namespace] as TranslationTree;
      const candidate = resources[language]?.[namespace] as TranslationTree;
      expect(compareTranslations(reference, candidate)).toEqual([]);
    });
  });
});
