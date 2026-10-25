import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

export const GOAL_SCOPES = ['personal', 'team', 'company'] as const;
export const GOAL_STATUSES = ['draft', 'active', 'done', 'cancelled'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const MAX_GOAL_TITLE = 120;
export const MAX_GOAL_DESCRIPTION = 1000;
export const MAX_KEY_RESULT_UNIT = 20;
export const MAX_CHECK_IN_COMMENT = 500;
export const MAX_KEY_RESULTS = 10;
export const MAX_VALUE = 1_000_000_000;

// ----- pure rules ------------------------------------------------------------------------------

const RANK: Record<GoalScope, number> = { personal: 0, team: 1, company: 2 };

/** A goal may align to a strictly wider one: personal → team or company, team → company. No cycles are possible. */
export const canAlign = (child: GoalScope, parent: GoalScope): boolean =>
  RANK[parent] > RANK[child];

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * How far a key result is: (current − start) / (target − start), clamped to 0–100 and rounded. A target below the
 * start is a goal to reduce something. A target equal to the start cannot be measured (0).
 */
export function keyResultProgress(kr: { start: number; target: number; current: number }): number {
  if (kr.target === kr.start) return 0;
  return Math.round(clampPercent(((kr.current - kr.start) / (kr.target - kr.start)) * 100));
}

/** A goal with key results has the average of their progress, otherwise its manual progress. */
export function goalProgress(
  manualPct: number,
  keyResults: readonly { start: number; target: number; current: number }[],
): number {
  if (keyResults.length === 0) return Math.round(clampPercent(manualPct));
  const sum = keyResults.reduce((total, kr) => total + keyResultProgress(kr), 0);
  return Math.round(sum / keyResults.length);
}

/** Open goals (draft, active) whose due date has passed. */
export const isGoalOverdue = (
  goal: { dueDate: string | null; status: GoalStatus },
  today: string,
): boolean =>
  (goal.status === 'draft' || goal.status === 'active') &&
  goal.dueDate !== null &&
  goal.dueDate < today;

// ----- requests --------------------------------------------------------------------------------

const title = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_GOAL_TITLE, { error: 'tooLong' });
const description = z
  .string()
  .trim()
  .max(MAX_GOAL_DESCRIPTION, { error: 'tooLong' })
  .transform((value) => (value === '' ? undefined : value));
const clearableDescription = z
  .string()
  .trim()
  .max(MAX_GOAL_DESCRIPTION, { error: 'tooLong' })
  .transform((value) => (value === '' ? null : value))
  .nullable();
const percent = z.number().int().min(0).max(100);
const value = z.number().min(-MAX_VALUE).max(MAX_VALUE);

export const createGoalRequestSchema = z
  .object({
    scope: z.enum(GOAL_SCOPES),
    /** Personal goals only: for whom (omitted = yourself). */
    employeeId: z.uuid().optional(),
    /** Team goals only. */
    teamId: z.uuid().optional(),
    title,
    description: description.optional(),
    status: z.enum(GOAL_STATUSES).default('active'),
    dueDate: dateOnlySchema.optional(),
    parentGoalId: z.uuid().optional(),
    progressPct: percent.default(0),
  })
  .strict()
  .refine((v) => (v.scope === 'team') === (v.teamId !== undefined), {
    path: ['teamId'],
    error: 'required',
  })
  .refine((v) => v.scope === 'personal' || v.employeeId === undefined, {
    path: ['employeeId'],
    error: 'invalid',
  });
export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;

export const updateGoalRequestSchema = z
  .object({
    title,
    description: clearableDescription,
    status: z.enum(GOAL_STATUSES),
    dueDate: dateOnlySchema.nullable(),
    parentGoalId: z.uuid().nullable(),
    progressPct: percent,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateGoalRequest = z.infer<typeof updateGoalRequestSchema>;

const unit = z
  .string()
  .trim()
  .max(MAX_KEY_RESULT_UNIT, { error: 'tooLong' })
  .transform((v) => (v === '' ? undefined : v));

export const createKeyResultRequestSchema = z
  .object({
    title,
    unit: unit.optional(),
    startValue: value.default(0),
    targetValue: value,
    /** Omitted = the start value. */
    currentValue: value.optional(),
  })
  .strict()
  .refine((v) => v.targetValue !== v.startValue, { path: ['targetValue'], error: 'same_as_start' });
export type CreateKeyResultRequest = z.infer<typeof createKeyResultRequestSchema>;

export const updateKeyResultRequestSchema = z
  .object({
    title,
    unit: z
      .string()
      .trim()
      .max(MAX_KEY_RESULT_UNIT, { error: 'tooLong' })
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    startValue: value,
    targetValue: value,
    currentValue: value,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateKeyResultRequest = z.infer<typeof updateKeyResultRequestSchema>;

export const goalCheckInRequestSchema = z
  .object({
    comment: z
      .string()
      .trim()
      .max(MAX_CHECK_IN_COMMENT, { error: 'tooLong' })
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .strict();
export type GoalCheckInRequest = z.infer<typeof goalCheckInRequestSchema>;

export const goalQuerySchema = z.object({
  scope: z.enum([...GOAL_SCOPES, 'all']).default('all'),
  /** "open" = draft and active. */
  status: z.enum([...GOAL_STATUSES, 'open', 'all']).default('open'),
  teamId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type GoalQuery = z.infer<typeof goalQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const goalSummarySchema = z.object({
  id: z.uuid(),
  scope: z.enum(GOAL_SCOPES),
  owner: person,
  team: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  title: z.string(),
  status: z.enum(GOAL_STATUSES),
  dueDate: z.string().nullable(),
  /** Effective progress: from the key results when there are any, else the manual value. */
  progressPct: z.number().int(),
  keyResultCount: z.number().int(),
  overdue: z.boolean(),
  parent: z.object({ id: z.uuid(), title: z.string(), scope: z.enum(GOAL_SCOPES) }).nullable(),
  /** The caller may change it, check in and delete it. */
  canEdit: z.boolean(),
});
export type GoalSummary = z.infer<typeof goalSummarySchema>;

export const keyResultSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  unit: z.string().nullable(),
  startValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  progressPct: z.number().int(),
});
export type KeyResult = z.infer<typeof keyResultSchema>;

export const goalDetailSchema = goalSummarySchema.extend({
  description: z.string().nullable(),
  /** The manual value, used while there are no key results. */
  manualProgressPct: z.number().int(),
  keyResults: z.array(keyResultSchema),
  updates: z.array(
    z.object({
      id: z.uuid(),
      author: person,
      progressPct: z.number().int(),
      comment: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  /** Goals aligned to this one that the caller may see. */
  children: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      scope: z.enum(GOAL_SCOPES),
      status: z.enum(GOAL_STATUSES),
      progressPct: z.number().int(),
    }),
  ),
});
export type GoalDetail = z.infer<typeof goalDetailSchema>;

export const goalListSchema = z.object({
  items: z.array(goalSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type GoalList = z.infer<typeof goalListSchema>;

export const goalTeamsSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type GoalTeams = z.infer<typeof goalTeamsSchema>;
