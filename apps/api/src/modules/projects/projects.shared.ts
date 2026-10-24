import { AppException } from '../../common/errors/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';

export const dateOut = (date: Date): string => date.toISOString().slice(0, 10);
export const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);
export const escapeLike = (word: string): string => word.replace(/[\\%_]/g, '\\$&');

export const notFound = (what: string) =>
  new AppException('NOT_FOUND', { message: `${what} not found` });
export const forbidden = (message: string) => new AppException('FORBIDDEN', { message });
export const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });
export const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });

/** A unique-constraint clash as a conflict that names the field; anything else passes through. */
export async function guardUnique<T>(run: () => Promise<T>, field: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(field, `The ${field} is already in use`);
    }
    throw error;
  }
}

export const PROJECT_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  clientId: true,
  status: true,
  priority: true,
  isBillable: true,
  budgetHours: true,
  startDate: true,
  endDate: true,
  leadEmployeeId: true,
  client: { select: { id: true, name: true } },
  lead: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProjectSelect;
export type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;
