import { Controller, Post, Body, Headers, UseGuards, Req, HttpCode, HttpStatus, Get, Param, UnauthorizedException } from '@nestjs/common';
import { TopupService, type TopupStatusResponse } from './topup.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { IsInt, Min, Max } from 'class-validator';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';

export class InitiateTopupDto {
  @IsInt()
  @Min(10000)
  @Max(100000000)
  amountKobo!: number;
}

@Controller('topup')
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Post('korapay/initiate')
  @UseGuards(JwtAuthGuard)
  async initiate(
    @Req() req: AuthenticatedRequest,
    @Body() body: InitiateTopupDto
  ): Promise<{ reference: string; paymentUrl: string }> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.topupService.initiate(userId, body.amountKobo);
  }

  @Get('status/:reference')
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getStatus(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
  ): Promise<TopupStatusResponse> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.topupService.getStatusForUser(userId, reference);
  }

  @Post('korapay/webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() payload: unknown,
    @Headers('x-korapay-signature') signature: string
  ): Promise<{ success: true }> {
    return this.topupService.handleWebhook(payload, signature);
  }
}
