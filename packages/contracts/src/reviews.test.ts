import { describe, expect, it } from 'vitest';
import {
  calibrationRequestSchema,
  canMoveCycle,
  createCompetencyRequestSchema,
  createReviewCycleRequestSchema,
  finalRating,
  isPartOverdue,
  isWritable,
  managerReviewRequestSchema,
  nextCycleStatus,
  reopenRequestSchema,
  reviewListQuerySchema,
  reviewVisibility,
  selfReviewRequestSchema,
  updateCompetencyRequestSchema,
  updateReviewCycleRequestSchema,
  type ReviewCycleStatus,
} from './reviews.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const OTHER = '0192f5a0-0000-7000-8000-00000000000b';
const cycle = {
  name: ' H2 2026 ',
  periodStart: '2026-07-01',
  periodEnd: '2026-12-31',
  selfDue: '2027-01-15',
  managerDue: '2027-01-31',
};

describe('cycle status', () => {
  it.each([
    ['draft', 'open'],
    ['open', 'calibration'],
    ['calibration', 'closed'],
    ['closed', null],
  ] as const)('%s → %s', (from, to) => {
    expect(nextCycleStatus(from)).toBe(to);
  });

  it('only moves forward by one step', () => {
    const all: ReviewCycleStatus[] = ['draft', 'open', 'calibration', 'closed'];
    for (const from of all) {
      for (const to of all) {
        expect(canMoveCycle(from, to), `${from} → ${to}`).toBe(nextCycleStatus(from) === to);
      }
    }
    expect(canMoveCycle('open', 'draft')).toBe(false);
    expect(canMoveCycle('draft', 'closed')).toBe(false);
  });

  it('can be written only while open', () => {
    expect(
      ['draft', 'open', 'calibration', 'closed'].map((s) => isWritable(s as ReviewCycleStatus)),
    ).toEqual([false, true, false, false]);
  });
});

describe('finalRating', () => {
  it.each([
    [{ calibratedRating: 4, overallRating: 3 }, 4],
    [{ calibratedRating: null, overallRating: 3 }, 3],
    [{ calibratedRating: 2, overallRating: null }, 2],
    [{ calibratedRating: null, overallRating: null }, null],
  ])('%j → %s', (review, expected) => {
    expect(finalRating(review)).toBe(expected);
  });
});

describe('isPartOverdue', () => {
  const part = { due: '2027-01-15', submitted: false };
  it('is overdue after the due date while the cycle is open and nothing is submitted', () => {
    expect(isPartOverdue(part, 'open', '2027-01-16')).toBe(true);
  });
  it.each([
    ['on the due date', part, 'open', '2027-01-15'],
    ['before the due date', part, 'open', '2027-01-01'],
    ['when submitted', { ...part, submitted: true }, 'open', '2027-02-01'],
    ['in calibration', part, 'calibration', '2027-02-01'],
    ['when closed', part, 'closed', '2027-02-01'],
    ['in draft', part, 'draft', '2027-02-01'],
  ] as const)('is not overdue %s', (_label, p, status, today) => {
    expect(isPartOverdue(p, status, today)).toBe(false);
  });
});

describe('reviewVisibility', () => {
  const base = {
    selfSubmitted: true,
    managerSubmitted: true,
    released: false,
    isManagerAuthor: false,
  };

  it('shows an employee their own part, and the rest only after release', () => {
    expect(reviewVisibility({ ...base, reader: 'employee' })).toEqual({
      self: true,
      manager: false,
      calibrated: false,
      finalRating: false,
    });
    expect(reviewVisibility({ ...base, reader: 'employee', selfSubmitted: false })).toMatchObject({
      self: true,
    });
    expect(reviewVisibility({ ...base, reader: 'employee', released: true })).toEqual({
      self: true,
      manager: true,
      calibrated: false,
      finalRating: true,
    });
  });

  it('never shows an employee a manager part that was not submitted, even when released', () => {
    expect(
      reviewVisibility({ ...base, reader: 'employee', released: true, managerSubmitted: false }),
    ).toMatchObject({ manager: false, finalRating: false });
  });

  it('shows a reviewer the self part once submitted, their own draft and others’ submitted work', () => {
    expect(reviewVisibility({ ...base, reader: 'reviewer', selfSubmitted: false })).toMatchObject({
      self: false,
    });
    expect(reviewVisibility({ ...base, reader: 'reviewer' })).toMatchObject({
      self: true,
      manager: true,
    });
    expect(
      reviewVisibility({ ...base, reader: 'reviewer', managerSubmitted: false }),
    ).toMatchObject({ manager: false });
    expect(
      reviewVisibility({
        ...base,
        reader: 'reviewer',
        managerSubmitted: false,
        isManagerAuthor: true,
      }),
    ).toMatchObject({ manager: true });
  });

  it('keeps the calibrated rating from reviewers, and the final rating until release', () => {
    const v = reviewVisibility({ ...base, reader: 'reviewer' });
    expect(v.calibrated).toBe(false);
    expect(v.finalRating).toBe(false);
    expect(reviewVisibility({ ...base, reader: 'reviewer', released: true }).finalRating).toBe(
      true,
    );
  });

  it('shows a calibrator all submitted work and the calibrated rating, never a draft', () => {
    expect(reviewVisibility({ ...base, reader: 'calibrator' })).toEqual({
      self: true,
      manager: true,
      calibrated: true,
      finalRating: true,
    });
    expect(
      reviewVisibility({
        ...base,
        reader: 'calibrator',
        selfSubmitted: false,
        managerSubmitted: false,
        isManagerAuthor: true,
      }),
    ).toMatchObject({ self: false, manager: false, calibrated: true });
  });
});

describe('createReviewCycleRequestSchema', () => {
  it('accepts a cycle and trims the name', () => {
    expect(createReviewCycleRequestSchema.parse(cycle).name).toBe('H2 2026');
    expect(
      createReviewCycleRequestSchema.safeParse({ ...cycle, copyFromCycleId: ID }).success,
    ).toBe(true);
  });
  it.each([
    ['no name', { name: ' ' }],
    ['a long name', { name: 'x'.repeat(81) }],
    ['a period that ends before it starts', { periodEnd: '2026-06-30' }],
    ['a manager deadline before the self deadline', { managerDue: '2027-01-10' }],
    ['a bad date', { selfDue: '15.1.2027' }],
    ['a bad copy source', { copyFromCycleId: 'x' }],
    ['unknown fields', { status: 'open' }],
  ])('refuses %s', (_label, change) => {
    expect(createReviewCycleRequestSchema.safeParse({ ...cycle, ...change }).success).toBe(false);
  });
  it('accepts a one-day period and equal deadlines', () => {
    expect(
      createReviewCycleRequestSchema.safeParse({
        ...cycle,
        periodEnd: cycle.periodStart,
        managerDue: cycle.selfDue,
      }).success,
    ).toBe(true);
  });
});

describe('updateReviewCycleRequestSchema', () => {
  it('needs a field and checks the dates it carries', () => {
    expect(updateReviewCycleRequestSchema.safeParse({}).success).toBe(false);
    expect(updateReviewCycleRequestSchema.safeParse({ name: 'x' }).success).toBe(true);
    expect(
      updateReviewCycleRequestSchema.safeParse({
        periodStart: '2027-01-01',
        periodEnd: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(updateReviewCycleRequestSchema.safeParse({ status: 'open' }).success).toBe(false);
  });
});

describe('competencies', () => {
  it('trims, clears and limits', () => {
    expect(createCompetencyRequestSchema.parse({ name: ' Teamwork ', description: '  ' })).toEqual({
      name: 'Teamwork',
    });
    expect(updateCompetencyRequestSchema.parse({ description: ' ' })).toEqual({
      description: null,
    });
    expect(createCompetencyRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createCompetencyRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(
      createCompetencyRequestSchema.safeParse({ name: 'x', description: 'x'.repeat(301) }).success,
    ).toBe(false);
    expect(updateCompetencyRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('review requests', () => {
  const rating = { competencyId: ID, score: 4, comment: ' good ' };

  it('takes ratings and a summary, and trims texts', () => {
    const parsed = selfReviewRequestSchema.parse({ ratings: [rating], summary: ' A year ' });
    expect(parsed).toEqual({
      ratings: [{ competencyId: ID, score: 4, comment: 'good' }],
      summary: 'A year',
    });
    expect(selfReviewRequestSchema.safeParse({ ratings: [] }).success).toBe(true);
  });

  it.each([0, 6, 2.5, '3', null])('refuses a score of %s', (score) => {
    expect(selfReviewRequestSchema.safeParse({ ratings: [{ ...rating, score }] }).success).toBe(
      false,
    );
  });

  it('refuses two ratings for one competency, too many ratings, long texts and unknown fields', () => {
    expect(selfReviewRequestSchema.safeParse({ ratings: [rating, rating] }).success).toBe(false);
    const many = Array.from({ length: 13 }, (_, n) => ({
      competencyId: `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
      score: 3,
    }));
    expect(selfReviewRequestSchema.safeParse({ ratings: many }).success).toBe(false);
    expect(
      selfReviewRequestSchema.safeParse({ ratings: [], summary: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(
      selfReviewRequestSchema.safeParse({ ratings: [{ ...rating, comment: 'x'.repeat(501) }] })
        .success,
    ).toBe(false);
    expect(selfReviewRequestSchema.safeParse({ ratings: [], overallRating: 3 }).success).toBe(
      false,
    );
    expect(selfReviewRequestSchema.safeParse({ ratings: [{ ...rating, extra: 1 }] }).success).toBe(
      false,
    );
  });

  it('takes an overall rating in the manager part only', () => {
    expect(managerReviewRequestSchema.parse({ ratings: [], overallRating: 5 }).overallRating).toBe(
      5,
    );
    expect(managerReviewRequestSchema.safeParse({ ratings: [], overallRating: 6 }).success).toBe(
      false,
    );
    expect(managerReviewRequestSchema.safeParse({ ratings: [OTHER] }).success).toBe(false);
  });

  it('calibrates with a rating or clears it', () => {
    expect(calibrationRequestSchema.parse({ rating: 3 })).toEqual({ rating: 3 });
    expect(calibrationRequestSchema.parse({ rating: null })).toEqual({ rating: null });
    expect(calibrationRequestSchema.safeParse({}).success).toBe(false);
    expect(calibrationRequestSchema.safeParse({ rating: 0 }).success).toBe(false);
  });

  it('reopens one of two parts', () => {
    expect(reopenRequestSchema.safeParse({ part: 'self' }).success).toBe(true);
    expect(reopenRequestSchema.safeParse({ part: 'manager' }).success).toBe(true);
    expect(reopenRequestSchema.safeParse({ part: 'both' }).success).toBe(false);
  });
});

describe('reviewListQuerySchema', () => {
  it('defaults to my reviews', () => {
    expect(reviewListQuerySchema.parse({})).toEqual({ box: 'mine', page: 1, pageSize: 25 });
    expect(reviewListQuerySchema.parse({ box: 'team', cycleId: ID })).toMatchObject({
      box: 'team',
      cycleId: ID,
    });
  });
  it.each([{ box: 'everyone' }, { cycleId: 'x' }, { pageSize: 101 }, { page: 0 }])(
    'refuses %j',
    (q) => {
      expect(reviewListQuerySchema.safeParse(q).success).toBe(false);
    },
  );
});
