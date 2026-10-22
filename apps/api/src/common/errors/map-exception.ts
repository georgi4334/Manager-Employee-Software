import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, type ErrorCode, type ErrorDetail } from '@intime/contracts';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException } from './app-exception.js';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  params?: Record<string, unknown>;
}

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function fromStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 400 && status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
  }
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return exception.message;
}

function mapped(code: ErrorCode, message: string, extra: Partial<MappedError> = {}): MappedError {
  return { status: ERROR_STATUS[code], code, message, ...extra };
}

/** Pure mapping from anything that can be thrown to the public error shape. Unknown errors never leak details. */
export function mapException(exception: unknown): MappedError {
  if (exception instanceof AppException) {
    return mapped(exception.code, exception.message, {
      details: exception.details,
      params: exception.params,
    });
  }

  if (exception instanceof ZodError) {
    return mapped('VALIDATION_FAILED', 'Request validation failed', {
      details: zodIssuesToDetails(exception),
    });
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    // With the pg driver adapter Prisma does not report which fields clashed (only an internal index
    // name), so this stays generic; services needing a field-specific error throw an AppException.
    if (exception.code === 'P2002') {
      return mapped('CONFLICT', 'A record with the same unique value already exists');
    }
    if (exception.code === 'P2025') return mapped('NOT_FOUND', 'Record not found');
  }

  if (exception instanceof HttpException) {
    const code = fromStatus(exception.getStatus());
    return mapped(code, httpExceptionMessage(exception));
  }

  // Errors raised by Express middleware (e.g. body-parser) carry a numeric 4xx status.
  if (exception && typeof exception === 'object' && 'status' in exception) {
    const status = Number((exception as { status: unknown }).status);
    if (status >= 400 && status < 500) {
      const message = exception instanceof Error ? exception.message : 'Bad request';
      return mapped(fromStatus(status), message);
    }
  }

  return mapped('INTERNAL_ERROR', 'Internal server error');
}
