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
import {
  ReconcileService,
  ReconcileResult,
  OutgoingStatusResult,
  OutgoingStatusRequestItem,
} from './reconcile.service';
import { z } from 'zod';

// Each envelope element is left as unknown here; the service parses each one
// against TransactionEnvelopeSchema from /shared, which is the authoritative
// boundary check for envelope shape and invariants.
const ReconcileDtoSchema = z.object({
  envelopes: z.array(z.unknown()).min(1).max(50),
});

const ReconcileStatusDtoSchema = z.object({
  transactions: z.array(
    z.object({
      transactionId: z.string().min(1),
      signedEnvelope: z.unknown().optional(),
    }),
  ).min(1).max(50),
});

// Shape of the request after JwtAuthGuard has attached the verified payload.
// Defined locally to avoid widening the Express Request type globally.
interface AuthenticatedRequest {
  user?: { sub?: string };
}

@Controller('reconcile')
export class ReconcileController {
  constructor(private readonly reconcileService: ReconcileService) {}

  @Post()
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async reconcile(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ReconcileResult[]> {
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
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async status(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<OutgoingStatusResult[]> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in token');
    }

    const parseResult = ReconcileStatusDtoSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException('Invalid request body: transactions array required (1-50 items)');
    }

    return this.reconcileService.resolveOutgoingStatuses(
      userId,
      parseResult.data.transactions as OutgoingStatusRequestItem[],
    );
  }
}
