import type { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../../common/errors/app-exception.js';

export const num = (value: Prisma.Decimal | number | string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

export const dateOut = (date: Date): string => date.toISOString().slice(0, 10);
export const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);

export const notFound = (what: string) =>
  new AppException('NOT_FOUND', { message: `${what} not found` });
export const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });
export const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });
export const forbidden = (message: string) => new AppException('FORBIDDEN', { message });
