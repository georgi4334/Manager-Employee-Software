import { z } from 'zod';

/**
 * Stable, machine-readable error codes returned by the API. The frontend maps each code to a
 * translated message (EN/DE/BG); the API `message` is developer-facing English only.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'TENANT_SELECTION_REQUIRED',
  'TOKEN_INVALID',
  'LAST_ADMIN',
  'CANNOT_DISABLE_SELF',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  /** The credentials match several workspaces; params.workspaces lists them. */
  TENANT_SELECTION_REQUIRED: 409,
  /** An invitation or password-reset link is unknown, expired or already used. */
  TOKEN_INVALID: 400,
  /** The change would leave the workspace without an active administrator. */
  LAST_ADMIN: 409,
  /** Users cannot disable their own account. */
  CANNOT_DISABLE_SELF: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorDetailSchema = z.object({
  /** Dot-separated path of the offending field, e.g. "address.city". Empty for the root. */
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    status: z.number().int(),
    requestId: z.string(),
    details: z.array(errorDetailSchema).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
