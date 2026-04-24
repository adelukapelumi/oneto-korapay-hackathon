import { Module } from '@nestjs/common';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { KorapayService } from './korapay.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TopupController],
  providers: [TopupService, KorapayService],
  exports: [TopupService],
})
export class TopupModule {}
