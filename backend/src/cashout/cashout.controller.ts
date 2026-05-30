import { Controller, Post, Get, Body, Param, UseGuards, Request, Headers, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/role.guard';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import type { CashoutStatus, KorapayPayoutFeeBearer } from '@prisma/client';
import { MIN_CASHOUT_GROSS_KOBO, MIN_KORAPAY_TRANSFER_KOBO } from '@oneto/shared';
import { parseManualPayoutRequiredMetadata } from './manual-payout-metadata';

type CashoutResponseShape = {
  id: string;
  amountKobo: bigint;
  grossAmountKobo?: bigint | null;
  onetoFeeBps: number;
  onetoFeeKobo?: bigint | null;
  korapayPayoutFeeKobo?: bigint | null;
  korapayPayoutFeeBearer?: KorapayPayoutFeeBearer | null;
  korapayPayoutFeeDeductedFromRecipient?: boolean | null;
  netPayoutKobo?: bigint | null;
  korapayTransferAmountKobo?: bigint | null;
  korapayResponse?: unknown;
  status: CashoutStatus;
  requestedAt: Date;
};

@Controller('cashout')
export class CashoutController {
  constructor(private readonly cashoutService: CashoutService) {}

  private readonly minimumCashoutGrossKobo = MIN_CASHOUT_GROSS_KOBO.toString();
  private readonly minimumKorapayTransferKobo = MIN_KORAPAY_TRANSFER_KOBO.toString();

  private requireUserSub(req: AuthenticatedRequest): string {
    if (!req.user?.sub) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return req.user.sub;
  }

  private serializeCashout(cashout: CashoutResponseShape) {
    const grossAmountKobo = cashout.grossAmountKobo ?? cashout.amountKobo;
    const manualMetadata = parseManualPayoutRequiredMetadata(cashout.korapayResponse);
    const configuredMode = this.cashoutService.getConfiguredPayoutMode();
    const payoutMode = manualMetadata?.payoutMode ?? configuredMode;
    const amountToPayKobo =
      manualMetadata?.amountToPayKobo ?? cashout.korapayTransferAmountKobo?.toString() ?? null;

    return {
      id: cashout.id,
      amountKobo: cashout.amountKobo.toString(),
      grossAmountKobo: grossAmountKobo.toString(),
      onetoFeeBps: cashout.onetoFeeBps,
      onetoFeeKobo: cashout.onetoFeeKobo?.toString() ?? null,
      korapayPayoutFeeKobo: cashout.korapayPayoutFeeKobo?.toString() ?? null,
      korapayPayoutFeeBearer: cashout.korapayPayoutFeeBearer ?? 'UNKNOWN',
      korapayPayoutFeeDeductedFromRecipient:
        cashout.korapayPayoutFeeDeductedFromRecipient ?? null,
      netPayoutKobo: cashout.netPayoutKobo?.toString() ?? null,
      korapayTransferAmountKobo: cashout.korapayTransferAmountKobo?.toString() ?? null,
      amountToPayKobo,
      payoutMode,
      manualPayoutRequired:
        payoutMode === "manual" && cashout.status === "PROCESSING",
      status: cashout.status,
      requestedAt: cashout.requestedAt,
    };
  }

  @Post('request')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard, RolesGuard(['MERCHANT']))
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async requestCashout(@Request() req: AuthenticatedRequest) {
    const cashout = await this.cashoutService.requestCashout(this.requireUserSub(req));
    return {
      cashout: this.serializeCashout(cashout),
      minimumCashoutGrossKobo: this.minimumCashoutGrossKobo,
      minimumKorapayTransferKobo: this.minimumKorapayTransferKobo,
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard, RolesGuard(['MERCHANT']))
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getStatus(@Request() req: AuthenticatedRequest) {
    const cashouts = await this.cashoutService.getRecentCashouts(this.requireUserSub(req));
    return {
      cashouts: cashouts.map((c) => this.serializeCashout(c)),
      minimumCashoutGrossKobo: this.minimumCashoutGrossKobo,
      minimumKorapayTransferKobo: this.minimumKorapayTransferKobo,
    };
  }

  @Post('approve/:id')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard, RolesGuard(['ADMIN']))
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async approveCashout(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.cashoutService.approveCashout(id, this.requireUserSub(req));
  }

  @Post('korapay/webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: unknown, @Headers('x-korapay-signature') signature: string) {
    return this.cashoutService.handlePayoutWebhook(payload, signature);
  }
}
