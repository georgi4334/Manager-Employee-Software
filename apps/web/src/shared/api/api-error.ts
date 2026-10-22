import { apiErrorBodySchema, type ErrorCode, type ErrorDetail } from '@intime/contracts';

/** Failures that never reach the API (offline, DNS, timeout) have no server error code. */
export type ClientErrorCode = 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly params?: Record<string, unknown>,
    readonly details?: ErrorDetail[],
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** Workspaces to choose from when the API answers TENANT_SELECTION_REQUIRED. */
  get workspaces(): { slug: string; name: string }[] {
    const list = this.params?.workspaces;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const { slug, name } = (item ?? {}) as { slug?: unknown; name?: unknown };
      return typeof slug === 'string' && typeof name === 'string' ? [{ slug, name }] : [];
    });
  }
}

export function isApiError(value: unknown, code?: ApiErrorCode): value is ApiError {
  return value instanceof ApiError && (code === undefined || value.code === code);
}

/** Turns an error response into an ApiError. Bodies that are not our error format become UNKNOWN. */
export async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      const { code, status, params, details, requestId } = parsed.data.error;
      return new ApiError(code, status, params, details, requestId);
    }
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  return new ApiError('UNKNOWN', response.status);
}
