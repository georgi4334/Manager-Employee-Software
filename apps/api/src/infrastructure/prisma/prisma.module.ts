import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { SystemPrismaService } from './system-prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, SystemPrismaService],
  exports: [PrismaService, SystemPrismaService],
})
export class PrismaModule {}
