import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { CashoutService } from '../cashout/cashout.service';
import { TopupService } from '../topup/topup.service';

type KorapayEvent =
  | 'charge.success'
  | 'charge.failed'
  | 'transfer.success'
  | 'transfer.failed';

@Controller('korapay')
export class KorapayWebhookController {
  private readonly logger = new Logger(KorapayWebhookController.name);

  constructor(
    private readonly topupService: TopupService,
    private readonly cashoutService: CashoutService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleUnifiedWebhook(
    @Body() payload: unknown,
    @Headers('x-korapay-signature') signature: string,
  ): Promise<{ success: boolean }> {
    const event = this.extractEvent(payload);

    if (event === 'charge.success' || event === 'charge.failed') {
      return this.topupService.handleWebhook(payload, signature);
    }

    if (event === 'transfer.success' || event === 'transfer.failed') {
      return this.cashoutService.handlePayoutWebhook(payload, signature);
    }

    this.logger.log(`Ignoring unsupported Korapay event: ${event ?? 'unknown'}`);
    return { success: true };
  }

  private extractEvent(payload: unknown): KorapayEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const rawEvent = (payload as { event?: unknown }).event;
    if (typeof rawEvent !== 'string') {
      return null;
    }

    return rawEvent as KorapayEvent;
  }
}
