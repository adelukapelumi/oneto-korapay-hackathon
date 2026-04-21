import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { TopupModule } from './topup/topup.module';

@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, AuthModule, ReconcileModule, TopupModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
