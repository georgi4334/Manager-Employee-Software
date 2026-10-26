import { AI_PROVIDERS, type AiKeyRequest } from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const keyFormSchema = z.object({
  provider: z.enum(AI_PROVIDERS, { error: 'required' }),
  model: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(80, { error: 'tooLong' })
    .regex(/^(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._:/-]*$/, { error: 'invalidModel' }),
  apiKey: z
    .string()
    .trim()
    .min(8, { error: 'invalidApiKey' })
    .max(256, { error: 'tooLong' })
    .regex(/^[\x21-\x7e]+$/, { error: 'invalidApiKey' }),
});
export type KeyFormValues = z.input<typeof keyFormSchema>;
export const emptyKey = (): KeyFormValues => ({ provider: 'groq', model: '', apiKey: '' });
export const toKeyRequest = (v: KeyFormValues): AiKeyRequest => ({
  provider: v.provider,
  model: v.model.trim(),
  apiKey: v.apiKey.trim(),
});

export const retentionFormSchema = z.object({
  retentionDays: z
    .string()
    .trim()
    .regex(/^\d+$/, { error: 'invalidNumber' })
    .refine((v) => Number(v) >= 1 && Number(v) <= 365, { error: 'invalidRetention' }),
});
export type RetentionFormValues = z.input<typeof retentionFormSchema>;
