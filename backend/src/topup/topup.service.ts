import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService, type KorapayTransactionVerification } from './korapay.service';
import { Prisma, LedgerEntryType } from '@prisma/client';
import { MAX_USER_BALANCE_KOBO } from '@oneto/shared';
import * as crypto from 'crypto';
import { KorapayWebhookSchema, type KorapayWebhookPayload } from './korapay-webhook.schema';

export type TopupStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

export interface TopupStatusResponse {
  reference: string;
  status: TopupStatus;
  amountKobo: string;
}

const SUCCESSFUL_KORAPAY_STATUSES = new Set(['success', 'successful']);
const FAILED_KORAPAY_STATUSES = new Set(['failed', 'failure']);

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
  ) { }

  async getStatusForUser(userId: string, reference: string): Promise<TopupStatusResponse> {
    const topup = await this.prisma.paymentTopup.findFirst({
      where: {
        reference,
        userId,
      },
      select: {
        reference: true,
        status: true,
        amountKobo: true,
      },
    });

    if (!topup) {
      throw new NotFoundException('topup_not_found');
    }

    return {
      reference: topup.reference,
      status: this.normalizeStoredTopupStatus(topup.status),
      amountKobo: topup.amountKobo.toString(),
    };
  }

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


    // Store reference→userId mapping so the webhook can identify the user
    // even when Korapay's payload omits the customer email (sandbox behavior).
    await this.prisma.paymentTopup.create({
      data: {
        reference,
        userId,
        amountKobo: BigInt(amountKobo),
        status: 'PENDING',
        korapayResponse: {} as Prisma.InputJsonValue,
      },
    });

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

  async handleWebhook(payload: unknown, signatureHeader: string | undefined): Promise<{ success: true }> {
    // 1. Verify signature on RAW payload.data
    const rawData =
      typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data?: unknown }).data
        : undefined;
    if (!payload || !this.korapayService.verifyWebhookSignature(rawData, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Schema validate
    const parseResult = KorapayWebhookSchema.safeParse(payload);
    if (!parseResult.success) {
      this.logger.warn({ issues: parseResult.error.issues }, 'Webhook payload failed schema validation');
      throw new BadRequestException('Invalid webhook payload structure');
    }
    const validated = parseResult.data;

    const { event, data } = validated;

    // Fix 3: Webhook event spoofing protection
    const normalizedWebhookStatus = this.normalizeKorapayStatus(data.status);
    if (
      (event === 'charge.success' && !this.isSuccessfulKorapayStatus(normalizedWebhookStatus)) ||
      (event === 'charge.failed' && !this.isFailedKorapayStatus(normalizedWebhookStatus))
    ) {
      this.logger.warn({ event, dataStatus: data.status }, 'Webhook event/status mismatch');
      return { success: true }; // return 200 to stop Korapay retries, but don't process
    }

    if (event !== 'charge.success' && event !== 'charge.failed') {
      this.logger.log(`Ignoring unhandled event type: ${event}`);
      return { success: true };
    }

    const reference = data.reference;
    const customerEmail = data.customer?.email;
    const amountKobo = this.parseMajorAmountToKobo(data.amount, 'webhook');

    // Primary: look up user via the PENDING PaymentTopup created during initiation.
    // Fallback: customer email from webhook payload (may be missing in sandbox).
    const pendingTopup = await this.prisma.paymentTopup.findUnique({
      where: { reference },
      select: { userId: true, status: true, amountKobo: true },
    });
    if (pendingTopup && pendingTopup.status !== 'PENDING') {
      this.logger.log(`Idempotent webhook: reference ${reference} already ${pendingTopup.status}`);
      return { success: true };
    }

    if (event === 'charge.failed') {
      try {
        await this.prisma.paymentTopup.upsert({
          where: { reference },
          update: {
            status: 'FAILED',
            korapayResponse: validated as unknown as Prisma.InputJsonValue,
          },
          create: {
            reference,
            userId: pendingTopup?.userId ?? 'UNKNOWN',
            amountKobo,
            status: 'FAILED',
            korapayResponse: validated as unknown as Prisma.InputJsonValue,
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

    if (!pendingTopup) {
      this.logger.warn(
        { reference, customerEmail },
        'Received top-up success webhook for unknown reference; refusing to credit without a pending top-up record',
      );
      return { success: true };
    }

    const verification = await this.korapayService.verifyTransaction(reference);
    const normalizedVerificationStatus = this.normalizeKorapayStatus(verification.status);

    if (!this.isSuccessfulKorapayStatus(normalizedVerificationStatus)) {
      if (this.isFailedKorapayStatus(normalizedVerificationStatus)) {
        await this.prisma.paymentTopup.update({
          where: { reference },
          data: {
            status: 'FAILED',
            korapayResponse: this.buildTopupAuditPayload(validated, verification) as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.paymentTopup.update({
          where: { reference },
          data: {
            korapayResponse: this.buildTopupAuditPayload(validated, verification) as Prisma.InputJsonValue,
          },
        });
      }

      return { success: true };
    }

    const verifiedAmountKobo = this.extractVerifiedAmountKobo(verification);
    if (pendingTopup.amountKobo !== verifiedAmountKobo) {
      this.logger.error(
        {
          reference,
          expectedAmountKobo: pendingTopup.amountKobo.toString(),
          receivedAmountKobo: verifiedAmountKobo.toString(),
        },
        'Top-up verification amount mismatch; refusing to credit balance',
      );

      await this.prisma.paymentTopup.update({
        where: { reference },
        data: {
          status: 'FAILED',
          korapayResponse: {
            ...this.buildTopupAuditPayload(validated, verification),
            internal_failure: 'amount_mismatch',
          } as Prisma.InputJsonValue,
        },
      });

      return { success: true };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: pendingTopup.userId },
    });
    if (!user) {
      this.logger.error({ reference, userId: pendingTopup.userId }, 'Pending top-up user missing');
      throw new InternalServerErrorException('Webhook processing failed');
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const latestTopup = await tx.paymentTopup.findUnique({
            where: { reference },
            select: {
              status: true,
              amountKobo: true,
            },
          });

          if (!latestTopup) {
            throw new Error('Pending top-up missing during transaction');
          }

          if (latestTopup.status !== 'PENDING') {
            return;
          }

          if (latestTopup.amountKobo !== verifiedAmountKobo) {
            await tx.paymentTopup.update({
              where: { reference },
              data: {
                status: 'FAILED',
                korapayResponse: {
                  ...this.buildTopupAuditPayload(validated, verification),
                  internal_failure: 'amount_mismatch',
                } as Prisma.InputJsonValue,
              },
            });
            return;
          }

          const freshUser = await tx.user.findUnique({
            where: { id: user.id },
            select: { verifiedBalanceKobo: true },
          });

          if (!freshUser) {
            throw new Error('User missing during transaction');
          }

          if (freshUser.verifiedBalanceKobo + verifiedAmountKobo > BigInt(MAX_USER_BALANCE_KOBO)) {
            this.logger.warn(
              {
                reference,
                userId: user.id,
                attemptedAmountKobo: verifiedAmountKobo.toString(),
                currentBalanceKobo: freshUser.verifiedBalanceKobo.toString(),
              },
              'Top-up failed: balance cap exceeded',
            );
            await tx.paymentTopup.update({
              where: { reference },
              data: {
                status: 'FAILED',
                korapayResponse: {
                  ...this.buildTopupAuditPayload(validated, verification),
                  internal_failure: 'balance_cap_exceeded',
                } as Prisma.InputJsonValue,
              },
            });
            return;
          }

          const operatingAccount = await tx.user.findUnique({
            where: { id: 'u_operating' },
          });

          if (!operatingAccount) {
            throw new Error('Operating account missing');
          }

          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              verifiedBalanceKobo: {
                increment: verifiedAmountKobo,
              },
            },
          });

          const updatedOperating = await tx.user.update({
            where: { id: 'u_operating' },
            data: {
              verifiedBalanceKobo: {
                decrement: verifiedAmountKobo,
              },
            },
          });

          await tx.paymentTopup.update({
            where: { reference },
            data: {
              status: 'SUCCESS',
              korapayResponse: this.buildTopupAuditPayload(validated, verification) as Prisma.InputJsonValue,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: reference,
              userId: user.id,
              type: LedgerEntryType.CREDIT,
              amountKobo: verifiedAmountKobo,
              balanceAfterKobo: updatedUser.verifiedBalanceKobo,
              description: `Top-up via Korapay ${reference}`,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: reference,
              userId: 'u_operating',
              type: LedgerEntryType.DEBIT,
              amountKobo: verifiedAmountKobo,
              balanceAfterKobo: updatedOperating.verifiedBalanceKobo,
              description: `Top-up credit to user ${user.id} ${reference}`,
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
      throw new InternalServerErrorException('Webhook processing failed');
    }

    return { success: true };
  }

  private normalizeKorapayStatus(status: string | undefined): string {
    return status?.trim().toLowerCase() ?? '';
  }

  private isSuccessfulKorapayStatus(status: string): boolean {
    return SUCCESSFUL_KORAPAY_STATUSES.has(status);
  }

  private isFailedKorapayStatus(status: string): boolean {
    return FAILED_KORAPAY_STATUSES.has(status);
  }

  private normalizeStoredTopupStatus(status: string): TopupStatus {
    const normalized = status.trim().toUpperCase();
    if (
      normalized === 'PENDING' ||
      normalized === 'SUCCESS' ||
      normalized === 'FAILED' ||
      normalized === 'EXPIRED'
    ) {
      return normalized;
    }

    return 'PENDING';
  }

  private parseMajorAmountToKobo(amount: string | number, source: 'webhook' | 'verification'): bigint {
    const raw = typeof amount === 'number' ? amount.toString() : amount.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      this.logger.error(`Invalid ${source} amount payload: ${amount}`);
      throw new BadRequestException(`Invalid amount in ${source} payload`);
    }

    const [wholePart, decimalPart = ''] = raw.split('.');
    const paddedDecimalPart = decimalPart.padEnd(2, '0');
    const koboText = `${wholePart}${paddedDecimalPart}`;
    const parsed = BigInt(koboText);

    if (parsed <= BigInt(0)) {
      this.logger.error(`Non-positive ${source} amount payload: ${amount}`);
      throw new BadRequestException(`Invalid amount in ${source} payload`);
    }

    return parsed;
  }

  private extractVerifiedAmountKobo(verification: KorapayTransactionVerification): bigint {
    const candidates = [verification.amountPaid, verification.amount];

    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }

      const raw = typeof candidate === 'number' ? candidate.toString() : candidate.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
        continue;
      }

      const [wholePart, decimalPart = ''] = raw.split('.');
      const parsed = BigInt(`${wholePart}${decimalPart.padEnd(2, '0')}`);
      if (parsed > BigInt(0)) {
        return parsed;
      }
    }

    throw new BadRequestException('Missing amount in verification payload');
  }

  private buildTopupAuditPayload(
    webhookPayload: KorapayWebhookPayload,
    verification: KorapayTransactionVerification,
  ): Record<string, unknown> {
    return {
      webhook: webhookPayload,
      verification: {
        status: verification.status,
        reference: verification.reference ?? null,
        amount: verification.amount ?? null,
        amountPaid: verification.amountPaid ?? null,
        currency: verification.currency ?? null,
      },
    };
  }
}
