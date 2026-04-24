import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService } from './korapay.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
  ) {}

  async initiate(userId: string, amountKobo: number): Promise<{ reference: string, paymentUrl: string }> {
    if (amountKobo < 10000 || amountKobo > 100000000) {
      throw new BadRequestException('Amount must be between 100 NGN and 1,000,000 NGN');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const reference = 'top_' + crypto.randomBytes(12).toString('hex');

    const result = await this.korapayService.initiateCheckout({
      amountKobo,
      reference,
      customerEmail: user.email,
    });

    return {
      reference,
      paymentUrl: result.paymentUrl,
    };
  }

  async handleWebhook(payload: any, signatureHeader: string | undefined): Promise<{ success: true }> {
    if (!payload || !this.korapayService.verifyWebhookSignature(payload.data, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const { event, data } = payload;

    if (event !== 'charge.success' && event !== 'charge.failed') {
      this.logger.log(`Ignoring unhandled event type: ${event}`);
      return { success: true };
    }

    const reference = data?.reference;
    const amountNgn = data?.amount;
    const customerEmail = data?.customer?.email;

    if (!reference) {
      this.logger.warn('Webhook payload missing reference');
      return { success: true };
    }

    const amountKobo = Math.round(Number(amountNgn || 0) * 100);

    const user = customerEmail ? await this.prisma.user.findUnique({
      where: { email: customerEmail },
    }) : null;

    if (event === 'charge.failed') {
      try {
        await this.prisma.paymentTopup.create({
          data: {
            reference,
            userId: user?.id || 'UNKNOWN',
            amountKobo: BigInt(amountKobo),
            status: 'FAILED',
            korapayResponse: payload,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { success: true }; // Idempotent success
        }
        this.logger.error(`Failed to record failed payment topup: ${err}`);
      }
      return { success: true };
    }

    // Handle charge.success
    if (!customerEmail) {
      this.logger.warn('Webhook payload missing customer email for successful charge');
      return { success: true };
    }

    if (!user) {
      this.logger.warn(`Webhook received for unknown user email: ${customerEmail}`);
      return { success: true };
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.paymentTopup.create({
            data: {
              reference,
              userId: user.id,
              amountKobo: BigInt(amountKobo),
              status: 'SUCCESS',
              korapayResponse: payload,
            },
          });

          await tx.user.update({
            where: { id: user.id },
            data: {
              verifiedBalanceKobo: {
                increment: amountKobo,
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Idempotent webhook delivery for reference: ${reference}`);
        return { success: true };
      }
      this.logger.error(`Transaction failed for webhook reference ${reference}: ${err}`);
    }

    return { success: true };
  }
}
