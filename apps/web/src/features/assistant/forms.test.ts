import { aiKeyRequestSchema, aiWorkspaceRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { emptyKey, keyFormSchema, retentionFormSchema, toKeyRequest } from './forms';

const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));
const ok = { ...emptyKey(), model: 'llama-3.3-70b-versatile', apiKey: 'gsk_abcdefgh1234' };

describe('key form', () => {
  it('sends a trimmed request that the API accepts', () => {
    const values = { ...ok, model: ' llama-3.3-70b-versatile ', apiKey: ' gsk_abcdefgh1234 ' };
    expect(keyFormSchema.safeParse(values).success).toBe(true);
    const body = toKeyRequest(values);
    expect(body).toEqual({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_abcdefgh1234',
    });
    expect(aiKeyRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no model', { model: ' ' }, ['model:required', 'model:invalidModel']],
    ['a model with a space', { model: 'a b' }, ['model:invalidModel']],
    ['a model that is a URL', { model: 'http://x.example/y' }, ['model:invalidModel']],
    ['a long model', { model: 'a'.repeat(81) }, ['model:tooLong']],
    ['a short key', { apiKey: 'short' }, ['apiKey:invalidApiKey']],
    ['a key with a space', { apiKey: 'abcd efgh ijkl' }, ['apiKey:invalidApiKey']],
    ['a long key', { apiKey: 'a'.repeat(257) }, ['apiKey:tooLong']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    const values = { ...ok, ...change };
    expect(issues(keyFormSchema.safeParse(values))).toEqual(expected);
    expect(aiKeyRequestSchema.safeParse(toKeyRequest(values)).success).toBe(false);
  });
});

describe('retention form', () => {
  it.each(['1', '90', '365'])('accepts %s days, as the API does', (days) => {
    expect(retentionFormSchema.safeParse({ retentionDays: days }).success).toBe(true);
    expect(aiWorkspaceRequestSchema.safeParse({ retentionDays: Number(days) }).success).toBe(true);
  });
  it.each(['0', '366', '1.5', 'x', ''])('refuses %j, as the API does', (days) => {
    expect(retentionFormSchema.safeParse({ retentionDays: days }).success).toBe(false);
    expect(aiWorkspaceRequestSchema.safeParse({ retentionDays: Number(days) }).success).toBe(false);
  });
});
