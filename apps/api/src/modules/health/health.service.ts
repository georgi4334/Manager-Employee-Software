import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export type CheckResult = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** A free-tier database may be waking up, so the check has its own short timeout. */
  async checkDatabase(timeoutMs = 3000): Promise<CheckResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Database check timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
