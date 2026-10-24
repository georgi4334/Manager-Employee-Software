import {
  LEAVE_COLORS,
  type AdjustBalanceRequest,
  type CreateHolidayRequest,
  type CreateLeaveRequest,
  type CreateLeaveTypeRequest,
  type PreviewLeaveRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const date = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const name = z.string().trim().min(1, { error: 'required' }).max(100, { error: 'tooLong' });
const halfDays = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .refine((v) => !Number.isNaN(Number(v)) && Number.isInteger(Number(v) * 2), {
    error: 'invalidDays',
  });
const country = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[A-Za-z]{2}$/.test(v), { error: 'invalidCountry' });

export const requestFormSchema = z
  .object({
    leaveTypeId: z.string().min(1, { error: 'required' }),
    startDate: date,
    endDate: date,
    halfDayStart: z.boolean(),
    halfDayEnd: z.boolean(),
    reason: z.string().trim().max(300, { error: 'tooLong' }),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'end_before_start' });
    }
    if (
      value.startDate &&
      value.startDate === value.endDate &&
      value.halfDayStart &&
      value.halfDayEnd
    ) {
      ctx.addIssue({ code: 'custom', path: ['halfDayEnd'], message: 'half_day_conflict' });
    }
  });
export type RequestFormValues = z.input<typeof requestFormSchema>;

export const toRequest = (v: RequestFormValues, isSick: boolean): CreateLeaveRequest => ({
  leaveTypeId: v.leaveTypeId,
  startDate: v.startDate,
  endDate: v.endDate,
  halfDayStart: v.halfDayStart,
  halfDayEnd: v.halfDayEnd,
  // Sick leave never sends a reason (the server drops it anyway).
  reason: isSick || v.reason.trim() === '' ? undefined : v.reason.trim(),
});

export const toPreview = (v: RequestFormValues): PreviewLeaveRequest => ({
  leaveTypeId: v.leaveTypeId,
  startDate: v.startDate,
  endDate: v.endDate,
  halfDayStart: v.halfDayStart,
  halfDayEnd: v.halfDayEnd,
});

export const decisionFormSchema = z.object({
  comment: z.string().trim().max(300, { error: 'tooLong' }),
});
export type DecisionFormValues = z.input<typeof decisionFormSchema>;

export const typeFormSchema = z.object({
  name,
  tracksBalance: z.boolean(),
  requiresApproval: z.boolean(),
  isSick: z.boolean(),
  color: z.enum(LEAVE_COLORS),
  isActive: z.boolean(),
  allowanceDays: halfDays,
  carryOverMaxDays: halfDays,
});
export type TypeFormValues = z.input<typeof typeFormSchema>;

export const toTypeRequest = (v: TypeFormValues): CreateLeaveTypeRequest => ({
  name: v.name.trim(),
  tracksBalance: v.tracksBalance,
  requiresApproval: v.requiresApproval,
  isSick: v.isSick,
  color: v.color,
  ...(v.tracksBalance
    ? { allowanceDays: Number(v.allowanceDays), carryOverMaxDays: Number(v.carryOverMaxDays) }
    : {}),
});

export const holidayFormSchema = z.object({ date, name, country, halfDay: z.boolean() });
export type HolidayFormValues = z.input<typeof holidayFormSchema>;

export const toHolidayRequest = (v: HolidayFormValues): CreateHolidayRequest => ({
  date: v.date,
  name: v.name.trim(),
  country: v.country.trim() === '' ? null : v.country.trim().toUpperCase(),
  halfDay: v.halfDay,
});

export const settingsFormSchema = z.object({
  hideSickTypeFromTeam: z.boolean(),
  defaultCountry: country,
});
export type SettingsFormValues = z.input<typeof settingsFormSchema>;

export const adjustFormSchema = z.object({
  employeeId: z.string().min(1, { error: 'required' }),
  year: z
    .string()
    .regex(/^\d{4}$/, { error: 'required' })
    .refine((v) => Number(v) >= 2000 && Number(v) <= 2100, { error: 'required' }),
  delta: halfDays.refine((v) => Number(v) !== 0 && Math.abs(Number(v)) <= 60, {
    error: 'invalidDays',
  }),
});
export type AdjustFormValues = z.input<typeof adjustFormSchema>;

export const toAdjustRequest = (
  v: AdjustFormValues,
  leaveTypeId: string,
): AdjustBalanceRequest => ({
  employeeId: v.employeeId,
  leaveTypeId,
  year: Number(v.year),
  delta: Number(v.delta),
});
