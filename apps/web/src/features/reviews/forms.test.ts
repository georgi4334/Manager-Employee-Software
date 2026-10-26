import {
  createReviewCycleRequestSchema,
  managerReviewRequestSchema,
  selfReviewRequestSchema,
  type Competency,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  competencyFormSchema,
  cycleFormSchema,
  emptyCycle,
  partSchema,
  toCreateCycle,
  toManagerRequest,
  toRatings,
  toSelfRequest,
  unscored,
  valuesOfPart,
  type CycleFormValues,
  type PartValues,
} from './forms';

const A = '0192f5a0-0000-7000-8000-00000000000a';
const B = '0192f5a0-0000-7000-8000-00000000000b';
const competencies: Competency[] = [
  { id: A, name: 'Teamwork', description: null },
  { id: B, name: 'Delivery', description: null },
];
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const cycle: CycleFormValues = {
  ...emptyCycle(),
  name: ' H2 2026 ',
  periodStart: '2026-07-01',
  periodEnd: '2026-12-31',
  selfDue: '2027-01-15',
  managerDue: '2027-01-31',
};

describe('cycle form', () => {
  it('accepts a cycle and sends what the API accepts', () => {
    expect(cycleFormSchema.safeParse(cycle).success).toBe(true);
    const body = toCreateCycle(cycle);
    expect(body).toEqual({
      name: 'H2 2026',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      selfDue: '2027-01-15',
      managerDue: '2027-01-31',
    });
    expect(createReviewCycleRequestSchema.safeParse(body).success).toBe(true);
    const copy = toCreateCycle({ ...cycle, copyFromCycleId: A });
    expect(copy.copyFromCycleId).toBe(A);
    expect(createReviewCycleRequestSchema.safeParse(copy).success).toBe(true);
  });

  it.each([
    ['no name', { name: ' ' }, ['name:required']],
    ['a long name', { name: 'x'.repeat(81) }, ['name:tooLong']],
    ['no start', { periodStart: '' }, ['periodStart:required']],
    ['a bad date', { selfDue: '15.1.2027' }, ['selfDue:invalidDate']],
    [
      'a period that ends before it starts',
      { periodEnd: '2026-06-30' },
      ['periodEnd:end_before_start'],
    ],
    [
      'a manager deadline before the self deadline',
      { managerDue: '2027-01-10' },
      ['managerDue:end_before_start'],
    ],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    const values = { ...cycle, ...change };
    expect(issues(cycleFormSchema.safeParse(values))).toEqual(expected);
    expect(createReviewCycleRequestSchema.safeParse(toCreateCycle(values)).success).toBe(false);
  });

  it('accepts a one-day period and equal deadlines', () => {
    const values = { ...cycle, periodEnd: cycle.periodStart, managerDue: cycle.selfDue };
    expect(cycleFormSchema.safeParse(values).success).toBe(true);
    expect(createReviewCycleRequestSchema.safeParse(toCreateCycle(values)).success).toBe(true);
  });
});

describe('competency form', () => {
  it('has the limits of the API', () => {
    expect(
      competencyFormSchema.safeParse({ name: 'x'.repeat(60), description: 'x'.repeat(300) })
        .success,
    ).toBe(true);
    expect(issues(competencyFormSchema.safeParse({ name: '', description: '' }))).toEqual([
      'name:required',
    ]);
    expect(
      issues(competencyFormSchema.safeParse({ name: 'x'.repeat(61), description: '' })),
    ).toEqual(['name:tooLong']);
    expect(
      issues(competencyFormSchema.safeParse({ name: 'x', description: 'x'.repeat(301) })),
    ).toEqual(['description:tooLong']);
  });
});

describe('the parts of a review', () => {
  const values: PartValues = {
    scores: { [A]: '4', [B]: '' },
    comments: { [A]: ' solid ', [B]: 'ignored without a score' },
    summary: ' My year ',
    overall: '5',
  };

  it('sends scored competencies only, trims comments and summary', () => {
    expect(toRatings(values, competencies)).toEqual([
      { competencyId: A, score: 4, comment: 'solid' },
    ]);
    const self = toSelfRequest(values, competencies);
    expect(self).toEqual({
      ratings: [{ competencyId: A, score: 4, comment: 'solid' }],
      summary: 'My year',
    });
    expect(selfReviewRequestSchema.safeParse(self).success).toBe(true);
    const manager = toManagerRequest(values, competencies);
    expect(manager.overallRating).toBe(5);
    expect(managerReviewRequestSchema.safeParse(manager).success).toBe(true);
  });

  it('leaves out an empty summary, comment and overall rating', () => {
    const bare = toManagerRequest(
      { scores: { [A]: '3' }, comments: { [A]: '  ' }, summary: ' ', overall: '' },
      competencies,
    );
    expect(bare).toEqual({ ratings: [{ competencyId: A, score: 3 }] });
    expect(managerReviewRequestSchema.safeParse(bare).success).toBe(true);
  });

  it('names the competencies still without a score', () => {
    expect(unscored(values, competencies).map((c) => c.id)).toEqual([B]);
    expect(unscored({ ...values, scores: { [A]: '1', [B]: '5' } }, competencies)).toEqual([]);
    expect(unscored({ ...values, scores: {} }, competencies)).toHaveLength(2);
  });

  it('checks scores and lengths like the API', () => {
    expect(partSchema.safeParse(values).success).toBe(true);
    expect(issues(partSchema.safeParse({ ...values, scores: { [A]: '6' } }))).toEqual([
      `scores.${A}:invalidScore`,
    ]);
    expect(issues(partSchema.safeParse({ ...values, scores: { [A]: '0' } }))).toEqual([
      `scores.${A}:invalidScore`,
    ]);
    expect(issues(partSchema.safeParse({ ...values, overall: '7' }))).toEqual([
      'overall:invalidScore',
    ]);
    expect(issues(partSchema.safeParse({ ...values, summary: 'x'.repeat(2001) }))).toEqual([
      'summary:tooLong',
    ]);
    expect(issues(partSchema.safeParse({ ...values, comments: { [A]: 'x'.repeat(501) } }))).toEqual(
      [`comments.${A}:tooLong`],
    );
    expect(
      partSchema.safeParse({
        ...values,
        summary: 'x'.repeat(2000),
        comments: { [A]: 'x'.repeat(500) },
      }).success,
    ).toBe(true);
  });

  it('is filled from a saved part', () => {
    const part = {
      ratings: [
        { competencyId: A, score: 2, comment: 'hm' },
        { competencyId: B, score: 5, comment: null },
      ],
      summary: 'Sum',
      submittedAt: null,
    };
    expect(valuesOfPart(part, 3)).toEqual({
      scores: { [A]: '2', [B]: '5' },
      comments: { [A]: 'hm', [B]: '' },
      summary: 'Sum',
      overall: '3',
    });
    expect(valuesOfPart(null)).toEqual({ scores: {}, comments: {}, summary: '', overall: '' });
  });
});
