import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException } from './app-exception.js';
import { mapException } from './map-exception.js';

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test', meta });

describe('mapException', () => {
  it('maps AppException with its code, status, details and params', () => {
    const mapped = mapException(
      new AppException('CONFLICT', {
        message: 'Email taken',
        details: [{ path: 'email', code: 'taken', message: 'taken' }],
        params: { field: 'email' },
      }),
    );
    expect(mapped).toEqual({
      status: 409,
      code: 'CONFLICT',
      message: 'Email taken',
      details: [{ path: 'email', code: 'taken', message: 'taken' }],
      params: { field: 'email' },
    });
  });

  it('maps a ZodError to VALIDATION_FAILED with per-field details', () => {
    const result = z.object({ address: z.object({ city: z.string().min(1) }) }).safeParse({
      address: { city: '' },
    });
    expect(result.success).toBe(false);
    const mapped = mapException(result.error);
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe('VALIDATION_FAILED');
    expect(mapped.details?.[0]?.path).toBe('address.city');
  });

  it.each([
    [new BadRequestException('bad'), 400, 'BAD_REQUEST'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new HttpException('teapot', 418), 400, 'BAD_REQUEST'],
    [new HttpException('limit', 429), 429, 'RATE_LIMITED'],
    [new HttpException('down', 503), 503, 'SERVICE_UNAVAILABLE'],
  ])('maps HttpException %#', (exception, status, code) => {
    expect(mapException(exception)).toMatchObject({ status, code });
  });

  it('joins class-validator style message arrays', () => {
    expect(mapException(new BadRequestException(['a is bad', 'b is bad'])).message).toBe(
      'a is bad; b is bad',
    );
  });

  it('maps a Prisma unique violation to a generic CONFLICT without internal details', () => {
    const mapped = mapException(prismaError('P2002', { target: ['slug'] }));
    expect(mapped).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(mapped.params).toBeUndefined();
  });

  it('maps a Prisma record-not-found to NOT_FOUND', () => {
    expect(mapException(prismaError('P2025'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('does not leak other Prisma errors', () => {
    const mapped = mapException(prismaError('P1001'));
    expect(mapped).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(mapped.message).toBe('Internal server error');
  });

  it('maps middleware errors that only carry a 4xx status (e.g. body-parser)', () => {
    expect(mapException(Object.assign(new Error('too large'), { status: 413 }))).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it.each([new Error('db password is hunter2'), 'a string', null, undefined, { status: 500 }])(
    'turns unknown throwable %# into a generic 500 without leaking its content',
    (thrown) => {
      const mapped = mapException(thrown);
      expect(mapped).toMatchObject({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    },
  );
});
