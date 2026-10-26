import {
  FEEDBACK_KINDS,
  FEEDBACK_VISIBILITIES,
  MAX_FEEDBACK_BODY,
  type CreateFeedbackRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const giveFormSchema = z.object({
  toEmployeeId: z.string().min(1, { error: 'required' }),
  kind: z.enum(FEEDBACK_KINDS),
  visibility: z.enum(FEEDBACK_VISIBILITIES),
  body: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(MAX_FEEDBACK_BODY, { error: 'tooLong' }),
});
export type GiveFormValues = z.input<typeof giveFormSchema>;

export const emptyFeedback = (): GiveFormValues => ({
  toEmployeeId: '',
  kind: 'praise',
  visibility: 'recipient',
  body: '',
});

export const toCreateFeedback = (v: GiveFormValues): CreateFeedbackRequest => ({
  toEmployeeId: v.toEmployeeId,
  kind: v.kind,
  visibility: v.visibility,
  body: v.body.trim(),
});
