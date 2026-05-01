import { Controller, Post, Get, Body, Param, UseGuards, Request, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/role.guard';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('cashout')
export class CashoutController {
  constructor(private readonly cashoutService: CashoutService) {}

  @Post('request')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard, RolesGuard(['MERCHANT']))
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async requestCashout(@Request() req: any) {
    const cashout = await this.cashoutService.requestCashout(req.user.sub);
    return {
      cashout: {
        id: cashout.id,
        amountKobo: cashout.amountKobo.toString(),
        status: cashout.status,
        requestedAt: cashout.requestedAt,
      },
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard(['MERCHANT']))
  async getStatus(@Request() req: any) {
    const cashouts = await this.cashoutService.getRecentCashouts(req.user.sub);
    return {
      cashouts: cashouts.map((c) => ({
        ...c,
        amountKobo: c.amountKobo.toString(),
      })),
    };
  }

  @Post('approve/:id')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard, RolesGuard(['ADMIN']))
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async approveCashout(@Param('id') id: string, @Request() req: any) {
    return this.cashoutService.approveCashout(id, req.user.sub);
  }

  @Post('korapay/webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: any, @Headers('x-korapay-signature') signature: string) {
    return this.cashoutService.handlePayoutWebhook(payload, signature);
  }
}
