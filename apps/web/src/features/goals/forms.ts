import {
  MAX_CHECK_IN_COMMENT,
  MAX_GOAL_DESCRIPTION,
  MAX_GOAL_TITLE,
  MAX_KEY_RESULT_UNIT,
  MAX_VALUE,
  GOAL_SCOPES,
  GOAL_STATUSES,
  type CreateGoalRequest,
  type CreateKeyResultRequest,
  type GoalCheckInRequest,
  type GoalDetail,
  type UpdateGoalRequest,
} from '@intime/contracts';
import { z } from 'zod';

const isDate = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const isNumber = (v: string) => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= MAX_VALUE;
};
const num = (v: string) => Number(v.trim().replace(',', '.'));

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const goalFormSchema = z
  .object({
    scope: z.enum(GOAL_SCOPES),
    teamId: z.string(),
    employeeId: z.string(),
    title: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_GOAL_TITLE, { error: 'tooLong' }),
    description: z.string().trim().max(MAX_GOAL_DESCRIPTION, { error: 'tooLong' }),
    status: z.enum(GOAL_STATUSES),
    dueDate: z.string().refine(isDate, { error: 'invalidDate' }),
    parentGoalId: z.string(),
    progressPct: z
      .string()
      .trim()
      .refine((v) => /^\d{1,3}$/.test(v) && Number(v) <= 100, { error: 'invalidPercent' }),
  })
  .refine((v) => v.scope !== 'team' || v.teamId !== '', { path: ['teamId'], error: 'required' });
export type GoalFormValues = z.input<typeof goalFormSchema>;

export const emptyGoal = (scope: GoalFormValues['scope'] = 'personal'): GoalFormValues => ({
  scope,
  teamId: '',
  employeeId: '',
  title: '',
  description: '',
  status: 'active',
  dueDate: '',
  parentGoalId: '',
  progressPct: '0',
});

export const valuesOfGoal = (g: GoalDetail): GoalFormValues => ({
  scope: g.scope,
  teamId: g.team?.id ?? '',
  employeeId: '',
  title: g.title,
  description: g.description ?? '',
  status: g.status,
  dueDate: g.dueDate ?? '',
  parentGoalId: g.parent?.id ?? '',
  progressPct: String(g.manualProgressPct),
});

export const toCreateGoal = (v: GoalFormValues): CreateGoalRequest => ({
  scope: v.scope,
  ...(v.scope === 'team' ? { teamId: v.teamId } : {}),
  ...(v.scope === 'personal' && v.employeeId ? { employeeId: v.employeeId } : {}),
  title: v.title.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
  status: v.status,
  ...(v.dueDate ? { dueDate: v.dueDate } : {}),
  ...(v.parentGoalId ? { parentGoalId: v.parentGoalId } : {}),
  progressPct: Number(v.progressPct),
});

/** Only what changed, so saving never resends (or fights over) fields the person did not touch. */
export const toUpdateGoal = (v: GoalFormValues, current: GoalFormValues): UpdateGoalRequest => {
  const body: UpdateGoalRequest = {};
  if (v.title.trim() !== current.title) body.title = v.title.trim();
  if (v.description.trim() !== current.description) {
    body.description = v.description.trim() === '' ? null : v.description.trim();
  }
  if (v.status !== current.status) body.status = v.status;
  if (v.dueDate !== current.dueDate) body.dueDate = v.dueDate === '' ? null : v.dueDate;
  if (v.parentGoalId !== current.parentGoalId) {
    body.parentGoalId = v.parentGoalId === '' ? null : v.parentGoalId;
  }
  if (v.progressPct.trim() !== current.progressPct) body.progressPct = Number(v.progressPct);
  return body;
};

const numberField = z.string().refine(isNumber, { error: 'invalidNumber' });

export const keyResultFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_GOAL_TITLE, { error: 'tooLong' }),
    unit: z.string().trim().max(MAX_KEY_RESULT_UNIT, { error: 'tooLong' }),
    startValue: numberField,
    targetValue: numberField,
    currentValue: z.string().refine((v) => v.trim() === '' || isNumber(v), {
      error: 'invalidNumber',
    }),
  })
  .refine(
    (v) =>
      !isNumber(v.startValue) ||
      !isNumber(v.targetValue) ||
      num(v.startValue) !== num(v.targetValue),
    {
      path: ['targetValue'],
      error: 'sameAsStart',
    },
  );
export type KeyResultFormValues = z.input<typeof keyResultFormSchema>;

export const emptyKeyResult = (): KeyResultFormValues => ({
  title: '',
  unit: '',
  startValue: '0',
  targetValue: '',
  currentValue: '',
});

export const toCreateKeyResult = (v: KeyResultFormValues): CreateKeyResultRequest => ({
  title: v.title.trim(),
  ...(v.unit.trim() ? { unit: v.unit.trim() } : {}),
  startValue: num(v.startValue),
  targetValue: num(v.targetValue),
  ...(v.currentValue.trim() ? { currentValue: num(v.currentValue) } : {}),
});

export const currentValueSchema = z.object({ currentValue: numberField });
export type CurrentValueFormValues = z.input<typeof currentValueSchema>;
export const toCurrentValue = (v: CurrentValueFormValues) => ({
  currentValue: num(v.currentValue),
});

export const checkInFormSchema = z.object({
  comment: z.string().trim().max(MAX_CHECK_IN_COMMENT, { error: 'tooLong' }),
});
export type CheckInFormValues = z.input<typeof checkInFormSchema>;
export const toCheckIn = (v: CheckInFormValues): GoalCheckInRequest =>
  v.comment.trim() ? { comment: v.comment.trim() } : {};
