import { Module } from '@nestjs/common';
import { ReconcileController } from './reconcile.controller';
import { ReconcileService } from './reconcile.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [PrismaModule, AuthModule, BalanceModule],
  controllers: [ReconcileController],
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}

