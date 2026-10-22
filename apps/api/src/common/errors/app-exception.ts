import { ERROR_STATUS, type ErrorCode, type ErrorDetail } from '@intime/contracts';

export interface AppExceptionOptions {
  /** Developer-facing English message; never shown to end users (the client translates the code). */
  message?: string;
  details?: ErrorDetail[];
  /** Values the client needs to render the translated message, e.g. { max: 5 }. */
  params?: Record<string, unknown>;
  cause?: unknown;
}

/** Throw this from services/guards for every expected failure; the filter turns it into the API error body. */
export class AppException extends Error {
  readonly status: number;
  readonly details?: ErrorDetail[];
  readonly params?: Record<string, unknown>;

  constructor(
    readonly code: ErrorCode,
    options: AppExceptionOptions = {},
  ) {
    super(options.message ?? code, { cause: options.cause });
    this.name = 'AppException';
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.params = options.params;
  }
}
