import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** Design-token colour names (no hex values anywhere). */
export const LEAVE_COLORS = ['primary', 'success', 'warning', 'danger', 'info', 'accent'] as const;
export type LeaveColor = (typeof LEAVE_COLORS)[number];

export const SYSTEM_LEAVE_TYPE_KEYS = ['annual', 'sick', 'unpaid', 'parental'] as const;
export type SystemLeaveTypeKey = (typeof SYSTEM_LEAVE_TYPE_KEYS)[number];

export const SYSTEM_LEAVE_TYPES: Record<
  SystemLeaveTypeKey,
  {
    tracksBalance: boolean;
    requiresApproval: boolean;
    isSick: boolean;
    color: LeaveColor;
    allowanceDays: number | null;
    carryOverMaxDays: number | null;
  }
> = {
  annual: {
    tracksBalance: true,
    requiresApproval: true,
    isSick: false,
    color: 'success',
    allowanceDays: 20,
    carryOverMaxDays: 5,
  },
  sick: {
    tracksBalance: false,
    requiresApproval: false,
    isSick: true,
    color: 'warning',
    allowanceDays: null,
    carryOverMaxDays: null,
  },
  unpaid: {
    tracksBalance: false,
    requiresApproval: true,
    isSick: false,
    color: 'info',
    allowanceDays: null,
    carryOverMaxDays: null,
  },
  parental: {
    tracksBalance: false,
    requiresApproval: true,
    isSick: false,
    color: 'accent',
    allowanceDays: null,
    carryOverMaxDays: null,
  },
};

export const MAX_LEAVE_TEXT = 300;
export const MAX_ALLOWANCE_DAYS = 365;
export const MAX_ADJUSTMENT_DAYS = 60;
/** How far back a request may start, and how far ahead it may end. */
export const LEAVE_MAX_PAST_DAYS = 60;
export const LEAVE_MAX_FUTURE_YEARS = 2;

const name = z.string().trim().min(1, { error: 'required' }).max(100, { error: 'tooLong' });
const halfDays = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((value) => Number.isInteger(value * 2), { error: 'invalidDays' });
const text = z
  .string()
  .trim()
  .max(MAX_LEAVE_TEXT, { error: 'tooLong' })
  .transform((value) => (value === '' ? undefined : value));
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'invalidCountry' });

// ----- types and policies ------------------------------------------------------------------------

const typeFields = {
  tracksBalance: z.boolean(),
  requiresApproval: z.boolean(),
  isSick: z.boolean(),
  color: z.enum(LEAVE_COLORS),
  isActive: z.boolean(),
  allowanceDays: halfDays(MAX_ALLOWANCE_DAYS).nullable(),
  carryOverMaxDays: halfDays(MAX_ALLOWANCE_DAYS).nullable(),
};

export const createLeaveTypeRequestSchema = z
  .object({
    name,
    tracksBalance: typeFields.tracksBalance,
    requiresApproval: typeFields.requiresApproval,
    isSick: typeFields.isSick,
    color: typeFields.color,
    allowanceDays: typeFields.allowanceDays.optional(),
    carryOverMaxDays: typeFields.carryOverMaxDays.optional(),
  })
  .strict();
export type CreateLeaveTypeRequest = z.infer<typeof createLeaveTypeRequestSchema>;

export const updateLeaveTypeRequestSchema = z
  .object({ name, ...typeFields })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateLeaveTypeRequest = z.infer<typeof updateLeaveTypeRequestSchema>;

export const leaveTypeSchema = z.object({
  id: z.uuid(),
  key: z.enum(SYSTEM_LEAVE_TYPE_KEYS).nullable(),
  name: z.string().nullable(),
  tracksBalance: z.boolean(),
  requiresApproval: z.boolean(),
  isSick: z.boolean(),
  color: z.enum(LEAVE_COLORS),
  isActive: z.boolean(),
  allowanceDays: z.number().nullable(),
  carryOverMaxDays: z.number().nullable(),
});
export type LeaveType = z.infer<typeof leaveTypeSchema>;

export const leaveSettingsSchema = z.object({
  hideSickTypeFromTeam: z.boolean(),
  defaultCountry: z.string().nullable(),
});
export type LeaveSettings = z.infer<typeof leaveSettingsSchema>;

export const updateLeaveSettingsRequestSchema = z
  .object({ hideSickTypeFromTeam: z.boolean(), defaultCountry: countryCode.nullable() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateLeaveSettingsRequest = z.infer<typeof updateLeaveSettingsRequestSchema>;

// ----- holidays ----------------------------------------------------------------------------------

export const createHolidayRequestSchema = z
  .object({
    date: dateOnlySchema,
    name,
    country: countryCode.nullable().default(null),
    halfDay: z.boolean().default(false),
  })
  .strict();
export type CreateHolidayRequest = z.infer<typeof createHolidayRequestSchema>;

export const holidayQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  country: countryCode.optional(),
});
export type HolidayQuery = z.infer<typeof holidayQuerySchema>;

export const holidaySchema = z.object({
  /** null for built-in days. */
  id: z.uuid().nullable(),
  date: z.string(),
  /** Built-in days have a key (translated by the client), custom days a name. */
  key: z.string().nullable(),
  name: z.string().nullable(),
  compensates: z.string().nullable(),
  country: z.string().nullable(),
  halfDay: z.boolean(),
});
export type Holiday = z.infer<typeof holidaySchema>;

// ----- requests ----------------------------------------------------------------------------------

const requestRange = {
  leaveTypeId: z.uuid(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  halfDayStart: z.boolean().default(false),
  halfDayEnd: z.boolean().default(false),
};

export const previewLeaveRequestSchema = z.object(requestRange).strict();
export type PreviewLeaveRequest = z.infer<typeof previewLeaveRequestSchema>;

export const createLeaveRequestSchema = z
  .object({ ...requestRange, reason: text.optional() })
  .strict();
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;

export const decisionRequestSchema = z.object({ comment: text.optional() }).strict();
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export const leaveRequestQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  /** Only requests that overlap [from, to]. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Pending requests the caller may decide (never their own). */
  approvable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeaveRequestQuery = z.infer<typeof leaveRequestQuerySchema>;

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  employee: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  /** null together with masked=true: shown as "absent" without the type. */
  leaveType: z
    .object({
      id: z.uuid(),
      key: z.enum(SYSTEM_LEAVE_TYPE_KEYS).nullable(),
      name: z.string().nullable(),
      color: z.enum(LEAVE_COLORS),
      isSick: z.boolean(),
    })
    .nullable(),
  masked: z.boolean(),
  startDate: z.string(),
  endDate: z.string(),
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
  days: z.number(),
  status: z.enum(LEAVE_REQUEST_STATUSES),
  /** Only for the owner and people who may approve the request. */
  reason: z.string().nullable(),
  decisionComment: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  canApprove: z.boolean(),
  canCancel: z.boolean(),
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const leaveRequestListSchema = z.object({
  items: z.array(leaveRequestSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type LeaveRequestList = z.infer<typeof leaveRequestListSchema>;

// ----- balances ----------------------------------------------------------------------------------

export const leaveBalanceSchema = z.object({
  leaveTypeId: z.uuid(),
  year: z.number().int(),
  entitled: z.number(),
  carriedOver: z.number(),
  adjustment: z.number(),
  used: z.number(),
  pending: z.number(),
  remaining: z.number(),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;

export const leaveBalancesSchema = z.object({
  employeeId: z.uuid(),
  year: z.number().int(),
  balances: z.array(leaveBalanceSchema),
});
export type LeaveBalances = z.infer<typeof leaveBalancesSchema>;

export const balanceQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type BalanceQuery = z.infer<typeof balanceQuerySchema>;

export const adjustBalanceRequestSchema = z
  .object({
    employeeId: z.uuid(),
    leaveTypeId: z.uuid(),
    year: z.number().int().min(2000).max(2100),
    delta: z
      .number()
      .min(-MAX_ADJUSTMENT_DAYS)
      .max(MAX_ADJUSTMENT_DAYS)
      .refine((value) => value !== 0 && Number.isInteger(value * 2), { error: 'invalidDays' }),
  })
  .strict();
export type AdjustBalanceRequest = z.infer<typeof adjustBalanceRequestSchema>;

export const leavePreviewSchema = z.object({
  /** Counted working days (0.5 steps). */
  days: z.number(),
  /** The days per date, so the form can show what is excluded. */
  dates: z.array(z.object({ date: z.string(), fraction: z.number() })),
  /** null for types without a balance. */
  remainingAfter: z.number().nullable(),
  enough: z.boolean(),
});
export type LeavePreview = z.infer<typeof leavePreviewSchema>;
