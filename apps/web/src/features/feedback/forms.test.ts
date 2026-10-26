import { createFeedbackRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { emptyFeedback, giveFormSchema, toCreateFeedback, type GiveFormValues } from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));
const base: GiveFormValues = { ...emptyFeedback(), toEmployeeId: ID, body: ' Great demo ' };

describe('give feedback form', () => {
  it('starts as private praise and sends what the API accepts', () => {
    expect(emptyFeedback()).toMatchObject({ kind: 'praise', visibility: 'recipient' });
    expect(giveFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateFeedback(base);
    expect(body).toEqual({
      toEmployeeId: ID,
      kind: 'praise',
      visibility: 'recipient',
      body: 'Great demo',
    });
    expect(createFeedbackRequestSchema.safeParse(body).success).toBe(true);
  });

  it('sends every choice', () => {
    const body = toCreateFeedback({
      ...base,
      kind: 'constructive',
      visibility: 'recipient_and_manager',
    });
    expect(body).toMatchObject({ kind: 'constructive', visibility: 'recipient_and_manager' });
    expect(createFeedbackRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['nobody chosen', { toEmployeeId: '' }, ['toEmployeeId:required']],
    ['no text', { body: '   ' }, ['body:required']],
    ['a long text', { body: 'x'.repeat(2001) }, ['body:tooLong']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    expect(issues(giveFormSchema.safeParse({ ...base, ...change }))).toEqual(expected);
  });

  it('has the same length limit as the API', () => {
    const edge = { ...base, body: 'x'.repeat(2000) };
    expect(giveFormSchema.safeParse(edge).success).toBe(true);
    expect(createFeedbackRequestSchema.safeParse(toCreateFeedback(edge)).success).toBe(true);
    expect(
      createFeedbackRequestSchema.safeParse({ ...toCreateFeedback(base), body: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown kind or visibility in the form too', () => {
    expect(giveFormSchema.safeParse({ ...base, kind: 'rant' }).success).toBe(false);
    expect(giveFormSchema.safeParse({ ...base, visibility: 'public' }).success).toBe(false);
  });
});
