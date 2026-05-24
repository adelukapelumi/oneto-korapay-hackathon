import { Module } from '@nestjs/common';
import { CashoutModule } from '../cashout/cashout.module';
import { TopupModule } from '../topup/topup.module';
import { KorapayWebhookController } from './korapay-webhook.controller';

@Module({
  imports: [TopupModule, CashoutModule],
  controllers: [KorapayWebhookController],
})
export class KorapayModule {}
