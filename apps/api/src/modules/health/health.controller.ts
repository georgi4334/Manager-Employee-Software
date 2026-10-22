import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running (does not touch the database)' })
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the API can serve requests (database reachable)' })
  async ready() {
    const database = await this.health.checkDatabase();
    if (database === 'down') {
      throw new AppException('SERVICE_UNAVAILABLE', { message: 'Database is not reachable' });
    }
    return { status: 'ok' as const, checks: { database } };
  }
}
