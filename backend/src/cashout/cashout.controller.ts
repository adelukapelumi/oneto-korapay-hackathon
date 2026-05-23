import { Controller, Post, Get, Body, Param, UseGuards, Request, Headers, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/role.guard';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import type { CashoutStatus } from '@prisma/client';

type CashoutResponseShape = {
  id: string;
  amountKobo: bigint;
  grossAmountKobo?: bigint | null;
  onetoFeeBps: number;
  onetoFeeKobo?: bigint | null;
  korapayPayoutFeeKobo?: bigint | null;
  netPayoutKobo?: bigint | null;
  finalPayoutAmountKobo?: bigint | null;
  status: CashoutStatus;
  requestedAt: Date;
};

@Controller('cashout')
export class CashoutController {
  constructor(private readonly cashoutService: CashoutService) {}

  private requireUserSub(req: AuthenticatedRequest): string {
    if (!req.user?.sub) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return req.user.sub;
  }

  private serializeCashout(cashout: CashoutResponseShape) {
    const grossAmountKobo = cashout.grossAmountKobo ?? cashout.amountKobo;

    return {
      id: cashout.id,
      amountKobo: cashout.amountKobo.toString(),
      grossAmountKobo: grossAmountKobo.toString(),
      onetoFeeBps: cashout.onetoFeeBps,
      onetoFeeKobo: cashout.onetoFeeKobo?.toString() ?? null,
      korapayPayoutFeeKobo: cashout.korapayPayoutFeeKobo?.toString() ?? null,
      netPayoutKobo: cashout.netPayoutKobo?.toString() ?? null,
      finalPayoutAmountKobo: cashout.finalPayoutAmountKobo?.toString() ?? null,
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
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard(['MERCHANT']))
  async getStatus(@Request() req: AuthenticatedRequest) {
    const cashouts = await this.cashoutService.getRecentCashouts(this.requireUserSub(req));
    return {
      cashouts: cashouts.map((c) => this.serializeCashout(c)),
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
