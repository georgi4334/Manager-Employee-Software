import { describe, expect, it } from 'vitest';
import { compareTranslations, flatten } from './validate';

describe('flatten', () => {
  it('flattens nested keys with dots', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual({
      'a.b': 'x',
      'a.c.d': 'y',
      e: 'z',
    });
  });
});

describe('compareTranslations', () => {
  const reference = { hello: 'Hello {{name}}', nested: { bye: 'Bye' } };

  it('passes for a complete translation', () => {
    expect(
      compareTranslations(reference, { hello: 'Hallo {{name}}', nested: { bye: 'Tschüss' } }),
    ).toEqual([]);
  });

  it('reports a missing key', () => {
    expect(compareTranslations(reference, { hello: 'Hallo {{name}}', nested: {} })).toEqual([
      'missing key "nested.bye"',
    ]);
  });

  it('reports an unexpected extra key', () => {
    const problems = compareTranslations(reference, {
      hello: 'Hallo {{name}}',
      nested: { bye: 'Tschüss' },
      extra: 'x',
    });
    expect(problems).toEqual(['unexpected key "extra"']);
  });

  it('reports empty values', () => {
    const problems = compareTranslations(reference, { hello: '  ', nested: { bye: 'Tschüss' } });
    expect(problems).toEqual(['empty value for "hello"']);
  });

  it('reports a changed or missing placeholder', () => {
    expect(
      compareTranslations(reference, { hello: 'Hallo {{vorname}}', nested: { bye: 'x' } }),
    ).toEqual(['placeholder mismatch in "hello"']);
    expect(compareTranslations(reference, { hello: 'Hallo', nested: { bye: 'x' } })).toEqual([
      'placeholder mismatch in "hello"',
    ]);
  });
});
