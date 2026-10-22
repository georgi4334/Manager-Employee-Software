import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../errors/app-exception.js';
import { zodIssuesToDetails } from '../errors/map-exception.js';

/** Usage: `@Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployee` (schemas live in @intime/contracts). */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_FAILED', {
        message: 'Request validation failed',
        details: zodIssuesToDetails(result.error),
      });
    }
    return result.data;
  }
}
