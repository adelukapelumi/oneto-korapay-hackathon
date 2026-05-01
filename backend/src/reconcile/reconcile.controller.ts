import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import { ReconcileService, ReconcileResult } from './reconcile.service';
import { z } from 'zod';

const ReconcileDtoSchema = z.object({
  envelopes: z.array(z.any()).min(1).max(50),
});

@Controller('reconcile')
export class ReconcileController {
  constructor(private readonly reconcileService: ReconcileService) {}

  @Post()
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async reconcile(@Req() req: any, @Body() body: any): Promise<ReconcileResult[]> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in token');
    }

    const parseResult = ReconcileDtoSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException('Invalid request body: envelopes array required (1-50 items)');
    }

    return this.reconcileService.reconcile(userId, parseResult.data.envelopes);
  }

  @Post('status')
  @UseGuards(JwtAuthGuard)
  async status() {
    // Stubbed for now as per instructions
    return { message: 'Not implemented' };
  }
}
