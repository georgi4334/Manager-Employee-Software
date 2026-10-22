import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException } from '../errors/app-exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({ email: z.email(), age: z.coerce.number().int().min(18) });
const pipe = new ZodValidationPipe(schema);

describe('ZodValidationPipe', () => {
  it('returns parsed and coerced data for valid input', () => {
    expect(pipe.transform({ email: 'a@b.co', age: '30' })).toEqual({ email: 'a@b.co', age: 30 });
  });

  it('strips unknown keys', () => {
    expect(pipe.transform({ email: 'a@b.co', age: 30, role: 'admin' })).toEqual({
      email: 'a@b.co',
      age: 30,
    });
  });

  it('throws VALIDATION_FAILED with a detail per invalid field', () => {
    try {
      pipe.transform({ email: 'nope', age: 5 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const exception = error as AppException;
      expect(exception.code).toBe('VALIDATION_FAILED');
      expect(exception.details?.map((d) => d.path).sort()).toEqual(['age', 'email']);
    }
  });

  it.each([undefined, null, 'string', 42, []])('rejects non-object body %p', (body) => {
    expect(() => pipe.transform(body)).toThrow(AppException);
  });
});
