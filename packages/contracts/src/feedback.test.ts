import { describe, expect, it } from 'vitest';
import {
  createFeedbackRequestSchema,
  feedbackQuerySchema,
  feedbackReportState,
} from './feedback.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const base = { toEmployeeId: ID, kind: 'praise', body: ' Great demo ' };

describe('feedbackReportState', () => {
  it.each([
    [{ reportedAt: null, keptAt: null }, 'none'],
    [{ reportedAt: new Date(), keptAt: null }, 'open'],
    [{ reportedAt: null, keptAt: new Date() }, 'kept'],
    [{ reportedAt: new Date(), keptAt: new Date() }, 'kept'],
  ])('%j → %s', (item, expected) => {
    expect(feedbackReportState(item)).toBe(expected);
  });
});

describe('createFeedbackRequestSchema', () => {
  it('keeps feedback private to the recipient by default and trims the text', () => {
    expect(createFeedbackRequestSchema.parse(base)).toEqual({
      toEmployeeId: ID,
      kind: 'praise',
      visibility: 'recipient',
      body: 'Great demo',
    });
    expect(
      createFeedbackRequestSchema.parse({
        ...base,
        kind: 'constructive',
        visibility: 'recipient_and_manager',
      }),
    ).toMatchObject({ kind: 'constructive', visibility: 'recipient_and_manager' });
  });

  it.each([
    ['no recipient', { toEmployeeId: undefined }],
    ['a bad recipient', { toEmployeeId: 'x' }],
    ['no kind', { kind: undefined }],
    ['an unknown kind', { kind: 'rant' }],
    ['an unknown visibility', { visibility: 'public' }],
    ['no text', { body: '   ' }],
    ['a long text', { body: 'x'.repeat(2001) }],
    ['an anonymous flag', { anonymous: true }],
    ['a sender', { fromEmployeeId: ID }],
  ])('refuses %s', (_label, change) => {
    expect(createFeedbackRequestSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });

  it('accepts the length limit', () => {
    expect(createFeedbackRequestSchema.safeParse({ ...base, body: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(createFeedbackRequestSchema.safeParse({ ...base, body: 'x' }).success).toBe(true);
  });
});

describe('feedbackQuerySchema', () => {
  it('defaults to your received feedback', () => {
    expect(feedbackQuerySchema.parse({})).toEqual({ box: 'received', page: 1, pageSize: 25 });
  });
  it('takes a box and a person, and refuses nonsense', () => {
    expect(feedbackQuerySchema.parse({ box: 'given' }).box).toBe('given');
    expect(feedbackQuerySchema.parse({ employeeId: ID }).employeeId).toBe(ID);
    expect(feedbackQuerySchema.safeParse({ box: 'all' }).success).toBe(false);
    expect(feedbackQuerySchema.safeParse({ employeeId: 'x' }).success).toBe(false);
    expect(feedbackQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(feedbackQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
