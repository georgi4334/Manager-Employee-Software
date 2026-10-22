import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, detectLanguage, isLanguage } from './languages';

describe('isLanguage', () => {
  it.each(['en', 'de', 'bg'])('accepts %s', (value) => {
    expect(isLanguage(value)).toBe(true);
  });

  it.each(['fr', 'EN', 'en-GB', '', null, undefined, 1])('rejects %p', (value) => {
    expect(isLanguage(value)).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('prefers a valid stored choice over the browser', () => {
    expect(detectLanguage('bg', ['de-DE'])).toBe('bg');
  });

  it('ignores an invalid stored value and uses the browser language', () => {
    expect(detectLanguage('klingon', ['de-AT', 'en'])).toBe('de');
  });

  it('matches regional browser tags and picks the first supported one', () => {
    expect(detectLanguage(null, ['fr-FR', 'bg-BG', 'de'])).toBe('bg');
    expect(detectLanguage(null, ['DE-ch'])).toBe('de');
  });

  it('falls back to English when nothing is supported or known', () => {
    expect(detectLanguage(null, ['fr-FR', 'es'])).toBe(DEFAULT_LANGUAGE);
    expect(detectLanguage(undefined, [])).toBe(DEFAULT_LANGUAGE);
  });
});
