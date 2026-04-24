import { Controller, Post, Body, Headers, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { TopupService } from './topup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsInt, Min, Max } from 'class-validator';
import { Request } from 'express';

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
    @Req() req: any,
    @Body() body: InitiateTopupDto
  ): Promise<{ reference: string; paymentUrl: string }> {
    const userId = req.user.sub;
    return this.topupService.initiate(userId, body.amountKobo);
  }

  @Post('korapay/webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() payload: any,
    @Headers('x-korapay-signature') signature: string
  ): Promise<{ success: true }> {
    return this.topupService.handleWebhook(payload, signature);
  }
}
