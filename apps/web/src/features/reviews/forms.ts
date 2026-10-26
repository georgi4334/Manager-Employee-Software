import {
  MAX_COMPETENCY_DESCRIPTION,
  MAX_COMPETENCY_NAME,
  MAX_CYCLE_NAME,
  MAX_RATING_COMMENT,
  MAX_REVIEW_SUMMARY,
  type Competency,
  type CreateReviewCycleRequest,
  type ManagerReviewRequest,
  type RatingInput,
  type ReviewDetail,
  type SelfReviewRequest,
} from '@intime/contracts';
import { z } from 'zod';

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const date = z
  .string()
  .min(1, { error: 'required' })
  .refine((v) => v === '' || isDate(v), { error: 'invalidDate' });

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const cycleFormSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'required' }).max(MAX_CYCLE_NAME, { error: 'tooLong' }),
    periodStart: date,
    periodEnd: date,
    selfDue: date,
    managerDue: date,
    copyFromCycleId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (isDate(v.periodStart) && isDate(v.periodEnd) && v.periodEnd < v.periodStart) {
      ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'end_before_start' });
    }
    if (isDate(v.selfDue) && isDate(v.managerDue) && v.managerDue < v.selfDue) {
      ctx.addIssue({ code: 'custom', path: ['managerDue'], message: 'end_before_start' });
    }
  });
export type CycleFormValues = z.input<typeof cycleFormSchema>;
export const emptyCycle = (): CycleFormValues => ({
  name: '',
  periodStart: '',
  periodEnd: '',
  selfDue: '',
  managerDue: '',
  copyFromCycleId: '',
});
export const toCreateCycle = (v: CycleFormValues): CreateReviewCycleRequest => ({
  name: v.name.trim(),
  periodStart: v.periodStart,
  periodEnd: v.periodEnd,
  selfDue: v.selfDue,
  managerDue: v.managerDue,
  ...(v.copyFromCycleId ? { copyFromCycleId: v.copyFromCycleId } : {}),
});

export const competencyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(MAX_COMPETENCY_NAME, { error: 'tooLong' }),
  description: z.string().trim().max(MAX_COMPETENCY_DESCRIPTION, { error: 'tooLong' }),
});
export type CompetencyFormValues = z.input<typeof competencyFormSchema>;

// ----- the self and manager parts --------------------------------------------------------------

/** What the person typed: a score (as text, '' = none) and a comment per competency, a summary, an overall rating. */
export interface PartValues {
  scores: Record<string, string>;
  comments: Record<string, string>;
  summary: string;
  overall: string;
}

export const partSchema = z.object({
  scores: z.record(z.string(), z.string().regex(/^([1-5])?$/, { error: 'invalidScore' })),
  comments: z.record(z.string(), z.string().trim().max(MAX_RATING_COMMENT, { error: 'tooLong' })),
  summary: z.string().trim().max(MAX_REVIEW_SUMMARY, { error: 'tooLong' }),
  overall: z.string().regex(/^([1-5])?$/, { error: 'invalidScore' }),
});

export function valuesOfPart(
  part: ReviewDetail['self'] | ReviewDetail['manager'],
  overall: number | null = null,
): PartValues {
  const scores: Record<string, string> = {};
  const comments: Record<string, string> = {};
  for (const r of part?.ratings ?? []) {
    scores[r.competencyId] = String(r.score);
    comments[r.competencyId] = r.comment ?? '';
  }
  return {
    scores,
    comments,
    summary: part?.summary ?? '',
    overall: overall === null ? '' : String(overall),
  };
}

/** Only the competencies that got a score are sent; a draft may be partial. */
export function toRatings(values: PartValues, competencies: readonly Competency[]): RatingInput[] {
  return competencies.flatMap((c) => {
    const score = values.scores[c.id];
    if (!score) return [];
    const comment = (values.comments[c.id] ?? '').trim();
    return [{ competencyId: c.id, score: Number(score), ...(comment ? { comment } : {}) }];
  });
}

export const toSelfRequest = (
  values: PartValues,
  competencies: readonly Competency[],
): SelfReviewRequest => ({
  ratings: toRatings(values, competencies),
  ...(values.summary.trim() ? { summary: values.summary.trim() } : {}),
});

export const toManagerRequest = (
  values: PartValues,
  competencies: readonly Competency[],
): ManagerReviewRequest => ({
  ratings: toRatings(values, competencies),
  ...(values.summary.trim() ? { summary: values.summary.trim() } : {}),
  ...(values.overall ? { overallRating: Number(values.overall) } : {}),
});

/** Competencies still without a score: a part can only be submitted when this is empty. */
export const unscored = (values: PartValues, competencies: readonly Competency[]): Competency[] =>
  competencies.filter((c) => !values.scores[c.id]);
