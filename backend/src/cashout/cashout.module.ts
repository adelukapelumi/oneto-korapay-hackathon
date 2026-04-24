import { Module } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { CashoutController } from './cashout.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TopupModule } from '../topup/topup.module';

@Module({
  imports: [PrismaModule, AuthModule, TopupModule],
  controllers: [CashoutController],
  providers: [CashoutService],
  exports: [CashoutService],
})
export class CashoutModule {}
