import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly serviceLogger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.serviceLogger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}