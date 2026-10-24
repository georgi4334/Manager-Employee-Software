import { z } from 'zod';
import { addDays, daysBetween } from './dates.js';
import { dateOnlySchema } from './employees.js';

export const CLIENT_STATUSES = ['active', 'archived'] as const;
export const PROJECT_STATUSES = ['planned', 'active', 'paused', 'done'] as const;
export const PROJECT_PRIORITIES = ['low', 'normal', 'high'] as const;
export const MILESTONE_STATUSES = ['open', 'done'] as const;
export const PROJECT_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];

export const MAX_PROJECT_NAME = 120;
export const MAX_PROJECT_DESCRIPTION = 1000;
export const MAX_ROLE = 60;
export const MAX_NOTES = 1000;
/** A milestone later than this many days overdue makes the project "off track". */
export const OFF_TRACK_AFTER_DAYS = 7;

// ----- rules (pure, unit-tested) ---------------------------------------------------------------

export interface HealthInput {
  status: ProjectStatus;
  endDate: string | null;
  today: string;
  milestones: readonly { dueDate: string; status: 'open' | 'done' }[];
}

/** Health of an active project; planned, paused and done projects have none. */
export function projectHealth(input: HealthInput): ProjectHealth | null {
  if (input.status !== 'active') return null;
  const open = input.milestones.filter((m) => m.status === 'open');
  const worstOverdue = open.reduce(
    (worst, m) => Math.max(worst, daysBetween(m.dueDate, input.today)),
    0,
  );
  if (worstOverdue > OFF_TRACK_AFTER_DAYS) return 'off_track';
  if (input.endDate && input.endDate < input.today) return 'off_track';
  if (worstOverdue > 0) return 'at_risk';
  if (
    input.endDate &&
    open.length > 0 &&
    daysBetween(input.today, input.endDate) <= OFF_TRACK_AFTER_DAYS
  ) {
    return 'at_risk';
  }
  return 'on_track';
}

export interface AllocationRange {
  fromDate: string;
  /** Open end = still running. */
  toDate: string | null;
  allocationPct: number;
}

/**
 * The most that is planned at any single day within `window` (the sum of the allocations of every range that
 * covers that day). Above 100 the person is over-allocated.
 */
export function peakAllocation(
  ranges: readonly AllocationRange[],
  window: { fromDate: string; toDate: string | null },
): number {
  const FAR = '9999-12-31';
  const from = window.fromDate;
  const to = window.toDate ?? FAR;
  const inside = ranges.filter((r) => r.fromDate <= to && (r.toDate ?? FAR) >= from);
  // The total only changes where a range starts, so those days (and the window start) are enough to look at.
  const candidates = new Set<string>([from]);
  for (const r of inside) if (r.fromDate > from && r.fromDate <= to) candidates.add(r.fromDate);
  let peak = 0;
  for (const day of candidates) {
    const total = inside
      .filter((r) => r.fromDate <= day && (r.toDate ?? FAR) >= day)
      .reduce((sum, r) => sum + r.allocationPct, 0);
    peak = Math.max(peak, total);
  }
  return peak;
}

/** Days a milestone is overdue (0 when done or not yet due). */
export const overdueDays = (
  milestone: { dueDate: string; status: 'open' | 'done' },
  today: string,
): number => (milestone.status === 'open' ? Math.max(0, daysBetween(milestone.dueDate, today)) : 0);

/** The last day an assignment ends when the leaver's termination date cuts it short. */
export const endedAt = (toDate: string | null, cutoff: string): string =>
  toDate && toDate < cutoff ? toDate : cutoff;

export const dayBefore = (date: string): string => addDays(date, -1);

// ----- clients ---------------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? undefined : value));
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value))
    .nullable();
const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_PROJECT_NAME, { error: 'tooLong' });
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'email' }));

export const createClientRequestSchema = z
  .object({
    name,
    contactName: text(100).optional(),
    contactEmail: email.optional(),
    notes: text(MAX_NOTES).optional(),
  })
  .strict();
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

export const updateClientRequestSchema = z
  .object({
    name,
    contactName: clearable(100),
    contactEmail: email.nullable(),
    notes: clearable(MAX_NOTES),
    status: z.enum(CLIENT_STATUSES),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;

export const clientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(CLIENT_STATUSES),
  projectCount: z.number().int().min(0),
});
export type Client = z.infer<typeof clientSchema>;
export const clientListSchema = z.object({ items: z.array(clientSchema) });
export type ClientList = z.infer<typeof clientListSchema>;

// ----- projects --------------------------------------------------------------------------------

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/, { error: 'invalidCode' });

const projectFields = {
  code,
  name,
  description: text(MAX_PROJECT_DESCRIPTION).optional(),
  clientId: z.uuid().optional(),
  status: z.enum(PROJECT_STATUSES).default('planned'),
  priority: z.enum(PROJECT_PRIORITIES).default('normal'),
  isBillable: z.boolean().default(true),
  budgetHours: z.number().min(0).max(1_000_000).multipleOf(0.5).optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.optional(),
  leadEmployeeId: z.uuid().optional(),
};

export const createProjectRequestSchema = z
  .object(projectFields)
  .strict()
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    path: ['endDate'],
    error: 'end_before_start',
  });
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    code,
    name,
    description: clearable(MAX_PROJECT_DESCRIPTION),
    clientId: z.uuid().nullable(),
    status: z.enum(PROJECT_STATUSES),
    priority: z.enum(PROJECT_PRIORITIES),
    isBillable: z.boolean(),
    budgetHours: z.number().min(0).max(1_000_000).multipleOf(0.5).nullable(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema.nullable(),
    leadEmployeeId: z.uuid().nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' })
  .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
    path: ['endDate'],
    error: 'end_before_start',
  });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...PROJECT_STATUSES, 'all']).default('all'),
  clientId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProjectQuery = z.infer<typeof projectQuerySchema>;

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const projectSummarySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  /** null for internal projects, and for people who may not see clients. */
  client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PROJECT_PRIORITIES),
  isBillable: z.boolean(),
  budgetHours: z.number().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  lead: person.nullable(),
  health: z.enum(PROJECT_HEALTH).nullable(),
  canEdit: z.boolean(),
  canStaff: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListSchema = z.object({
  items: z.array(projectSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ProjectList = z.infer<typeof projectListSchema>;

// ----- milestones ------------------------------------------------------------------------------

const milestoneTitle = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_PROJECT_NAME, { error: 'tooLong' });

export const createMilestoneRequestSchema = z
  .object({ title: milestoneTitle, dueDate: dateOnlySchema })
  .strict();
export type CreateMilestoneRequest = z.infer<typeof createMilestoneRequestSchema>;

export const updateMilestoneRequestSchema = z
  .object({ title: milestoneTitle, dueDate: dateOnlySchema, status: z.enum(MILESTONE_STATUSES) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateMilestoneRequest = z.infer<typeof updateMilestoneRequestSchema>;

export const milestoneSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  dueDate: z.string(),
  status: z.enum(MILESTONE_STATUSES),
  doneOn: z.string().nullable(),
  overdueDays: z.number().int().min(0),
});
export type Milestone = z.infer<typeof milestoneSchema>;

// ----- assignments -----------------------------------------------------------------------------

const allocation = z
  .number()
  .int()
  .min(1, { error: 'required' })
  .max(100, { error: 'invalidAllocation' });

export const createAssignmentRequestSchema = z
  .object({
    employeeId: z.uuid(),
    role: text(MAX_ROLE).optional(),
    allocationPct: allocation,
    fromDate: dateOnlySchema,
    toDate: dateOnlySchema.optional(),
  })
  .strict()
  .refine((value) => !value.toDate || value.toDate >= value.fromDate, {
    path: ['toDate'],
    error: 'end_before_start',
  });
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

export const updateAssignmentRequestSchema = z
  .object({
    role: clearable(MAX_ROLE),
    allocationPct: allocation,
    fromDate: dateOnlySchema,
    toDate: dateOnlySchema.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' })
  .refine((value) => !value.fromDate || !value.toDate || value.toDate >= value.fromDate, {
    path: ['toDate'],
    error: 'end_before_start',
  });
export type UpdateAssignmentRequest = z.infer<typeof updateAssignmentRequestSchema>;

export const assignmentSchema = z.object({
  id: z.uuid(),
  employee: person,
  role: z.string().nullable(),
  allocationPct: z.number().int(),
  fromDate: z.string(),
  toDate: z.string().nullable(),
  /** The person is planned above 100 % at some point of this assignment. */
  overAllocated: z.boolean(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string().nullable(),
  milestones: z.array(milestoneSchema),
  assignments: z.array(assignmentSchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
