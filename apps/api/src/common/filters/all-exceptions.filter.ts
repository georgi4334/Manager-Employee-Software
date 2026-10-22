import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@intime/contracts';
import type { Request, Response } from 'express';
import { mapException } from '../errors/map-exception.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();

    const mapped = mapException(exception);
    const requestId = String(request.id ?? request.headers['x-request-id'] ?? 'unknown');

    if (mapped.code === 'INTERNAL_ERROR') {
      // Unexpected: the full error goes to the logs only; the client gets the generic message.
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    } else if (mapped.status >= 500) {
      this.logger.warn({ code: mapped.code, requestId }, mapped.message);
    }

    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        status: mapped.status,
        requestId,
        ...(mapped.details && { details: mapped.details }),
        ...(mapped.params && { params: mapped.params }),
      },
    };
    response.status(mapped.status).json(body);
  }
}
