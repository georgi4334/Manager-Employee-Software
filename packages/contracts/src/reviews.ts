import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

export const REVIEW_CYCLE_STATUSES = ['draft', 'open', 'calibration', 'closed'] as const;
export type ReviewCycleStatus = (typeof REVIEW_CYCLE_STATUSES)[number];
export const REVIEW_PARTS = ['self', 'manager'] as const;
export type ReviewPart = (typeof REVIEW_PARTS)[number];
export const REVIEW_BOXES = ['mine', 'team', 'all'] as const;
export type ReviewBox = (typeof REVIEW_BOXES)[number];

export const MAX_CYCLE_NAME = 80;
export const MAX_COMPETENCY_NAME = 60;
export const MAX_COMPETENCY_DESCRIPTION = 300;
export const MAX_COMPETENCIES = 12;
export const MAX_REVIEW_SUMMARY = 2000;
export const MAX_RATING_COMMENT = 500;

// ----- rules (pure) ----------------------------------------------------------------------------

const NEXT: Record<ReviewCycleStatus, ReviewCycleStatus | null> = {
  draft: 'open',
  open: 'calibration',
  calibration: 'closed',
  closed: null,
};
/** A cycle only moves forward, one step at a time: draft → open → calibration → closed. */
export const nextCycleStatus = (status: ReviewCycleStatus): ReviewCycleStatus | null =>
  NEXT[status];
export const canMoveCycle = (from: ReviewCycleStatus, to: ReviewCycleStatus): boolean =>
  NEXT[from] === to;

/** Parts can be written while the cycle is open. */
export const isWritable = (status: ReviewCycleStatus): boolean => status === 'open';

/** The rating the employee finally receives: the calibrated one, else the manager's overall rating. */
export const finalRating = (review: {
  calibratedRating: number | null;
  overallRating: number | null;
}): number | null => review.calibratedRating ?? review.overallRating;

/** A part is overdue when it is not submitted and its due date has passed, in a cycle that is still open. */
export const isPartOverdue = (
  part: { due: string; submitted: boolean },
  cycleStatus: ReviewCycleStatus,
  today: string,
): boolean => cycleStatus === 'open' && !part.submitted && part.due < today;

export type ReviewReader = 'employee' | 'calibrator' | 'reviewer';

/** What a reader may see of a review (ADR 0023 section 4). */
export function reviewVisibility(ctx: {
  reader: ReviewReader;
  selfSubmitted: boolean;
  managerSubmitted: boolean;
  released: boolean;
  /** The reader wrote the manager part. */
  isManagerAuthor: boolean;
}): { self: boolean; manager: boolean; calibrated: boolean; finalRating: boolean } {
  switch (ctx.reader) {
    case 'employee':
      return {
        self: true,
        manager: ctx.released && ctx.managerSubmitted,
        calibrated: false,
        finalRating: ctx.released && ctx.managerSubmitted,
      };
    case 'calibrator':
      return {
        self: ctx.selfSubmitted,
        manager: ctx.managerSubmitted,
        calibrated: true,
        finalRating: ctx.managerSubmitted,
      };
    case 'reviewer':
      return {
        self: ctx.selfSubmitted,
        manager: ctx.managerSubmitted || ctx.isManagerAuthor,
        calibrated: false,
        finalRating: ctx.released && ctx.managerSubmitted,
      };
  }
}

// ----- requests --------------------------------------------------------------------------------

const cycleName = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_CYCLE_NAME, { error: 'tooLong' });

const cycleBase = {
  name: cycleName,
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  selfDue: dateOnlySchema,
  managerDue: dateOnlySchema,
};
type CycleDates = {
  periodStart?: string;
  periodEnd?: string;
  selfDue?: string;
  managerDue?: string;
};
const checkDates = (v: CycleDates, ctx: z.RefinementCtx) => {
  if (v.periodStart && v.periodEnd && v.periodEnd < v.periodStart) {
    ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'end_before_start' });
  }
  if (v.selfDue && v.managerDue && v.managerDue < v.selfDue) {
    ctx.addIssue({ code: 'custom', path: ['managerDue'], message: 'end_before_start' });
  }
};

export const createReviewCycleRequestSchema = z
  .object({ ...cycleBase, copyFromCycleId: z.uuid().optional() })
  .strict()
  .superRefine(checkDates);
export type CreateReviewCycleRequest = z.infer<typeof createReviewCycleRequestSchema>;

export const updateReviewCycleRequestSchema = z
  .object(cycleBase)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' })
  .superRefine(checkDates);
export type UpdateReviewCycleRequest = z.infer<typeof updateReviewCycleRequestSchema>;

const competencyName = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_COMPETENCY_NAME, { error: 'tooLong' });
export const createCompetencyRequestSchema = z
  .object({
    name: competencyName,
    description: z
      .string()
      .trim()
      .max(MAX_COMPETENCY_DESCRIPTION, { error: 'tooLong' })
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .strict();
export type CreateCompetencyRequest = z.infer<typeof createCompetencyRequestSchema>;
export const updateCompetencyRequestSchema = z
  .object({
    name: competencyName,
    description: z
      .string()
      .trim()
      .max(MAX_COMPETENCY_DESCRIPTION, { error: 'tooLong' })
      .transform((v) => (v === '' ? null : v))
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateCompetencyRequest = z.infer<typeof updateCompetencyRequestSchema>;

const score = z.number().int().min(1).max(5);
export const ratingInputSchema = z
  .object({
    competencyId: z.uuid(),
    score,
    comment: z
      .string()
      .trim()
      .max(MAX_RATING_COMMENT, { error: 'tooLong' })
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .strict();
export type RatingInput = z.infer<typeof ratingInputSchema>;

const summary = z
  .string()
  .trim()
  .max(MAX_REVIEW_SUMMARY, { error: 'tooLong' })
  .transform((v) => (v === '' ? undefined : v))
  .optional();
const ratings = z
  .array(ratingInputSchema)
  .max(MAX_COMPETENCIES)
  .refine((list) => new Set(list.map((r) => r.competencyId)).size === list.length, {
    error: 'duplicate',
  });

export const selfReviewRequestSchema = z.object({ ratings, summary }).strict();
export type SelfReviewRequest = z.infer<typeof selfReviewRequestSchema>;
export const managerReviewRequestSchema = z
  .object({ ratings, summary, overallRating: score.optional() })
  .strict();
export type ManagerReviewRequest = z.infer<typeof managerReviewRequestSchema>;

export const calibrationRequestSchema = z.object({ rating: score.nullable() }).strict();
export type CalibrationRequest = z.infer<typeof calibrationRequestSchema>;
export const reopenRequestSchema = z.object({ part: z.enum(REVIEW_PARTS) }).strict();
export type ReopenRequest = z.infer<typeof reopenRequestSchema>;

export const reviewListQuerySchema = z.object({
  cycleId: z.uuid().optional(),
  box: z.enum(REVIEW_BOXES).default('mine'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const competencySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
});
export type Competency = z.infer<typeof competencySchema>;

export const reviewCycleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  selfDue: z.string(),
  managerDue: z.string(),
  status: z.enum(REVIEW_CYCLE_STATUSES),
  competencies: z.array(competencySchema),
  /** For cycle managers: how far the cycle is. Null for everybody else. */
  progress: z
    .object({
      total: z.number().int(),
      selfSubmitted: z.number().int(),
      managerSubmitted: z.number().int(),
      calibrated: z.number().int(),
      released: z.number().int(),
    })
    .nullable(),
  canManage: z.boolean(),
});
export type ReviewCycle = z.infer<typeof reviewCycleSchema>;

export const reviewCycleListSchema = z.object({ items: z.array(reviewCycleSchema) });
export type ReviewCycleList = z.infer<typeof reviewCycleListSchema>;

export const reviewSummarySchema = z.object({
  id: z.uuid(),
  cycle: z.object({ id: z.uuid(), name: z.string(), status: z.enum(REVIEW_CYCLE_STATUSES) }),
  employee: person,
  selfSubmitted: z.boolean(),
  /** Null when the reader may not know yet (an employee before release). */
  managerSubmitted: z.boolean().nullable(),
  released: z.boolean(),
  finalRating: z.number().int().nullable(),
  selfOverdue: z.boolean(),
  managerOverdue: z.boolean().nullable(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const reviewListSchema = z.object({
  items: z.array(reviewSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ReviewList = z.infer<typeof reviewListSchema>;

const partSchema = z.object({
  ratings: z.array(
    z.object({
      competencyId: z.uuid(),
      score: z.number().int(),
      comment: z.string().nullable(),
    }),
  ),
  summary: z.string().nullable(),
  submittedAt: z.string().nullable(),
});

export const reviewDetailSchema = reviewSummarySchema.extend({
  cycleDetail: z.object({
    periodStart: z.string(),
    periodEnd: z.string(),
    selfDue: z.string(),
    managerDue: z.string(),
    competencies: z.array(competencySchema),
  }),
  self: partSchema.nullable(),
  manager: partSchema
    .extend({ overallRating: z.number().int().nullable(), author: person.nullable() })
    .nullable(),
  calibratedRating: z.number().int().nullable(),
  canWriteSelf: z.boolean(),
  canWriteManager: z.boolean(),
  canCalibrate: z.boolean(),
  canReopen: z.boolean(),
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;
