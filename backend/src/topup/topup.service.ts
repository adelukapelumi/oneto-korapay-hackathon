import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService, type KorapayTransactionVerification } from './korapay.service';
import { Prisma, LedgerEntryType } from '@prisma/client';
import { MAX_USER_BALANCE_KOBO } from '@oneto/shared';
import * as crypto from 'crypto';
import { KorapayWebhookSchema, type KorapayWebhookPayload } from './korapay-webhook.schema';

export type TopupStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
type TopupFeeBearer = 'STUDENT' | 'ONETO' | 'UNKNOWN';

export interface TopupStatusResponse {
  reference: string;
  status: TopupStatus;
  amountKobo: string;
}

const SUCCESSFUL_KORAPAY_STATUSES = new Set(['success', 'successful']);
const FAILED_KORAPAY_STATUSES = new Set(['failed', 'failure']);
const STUDENT_TOPUP_FEE_BEARER: TopupFeeBearer = 'STUDENT';
type TopupFinalizationSource = 'webhook' | 'status_poll';

interface TopupRecordSnapshot {
  reference: string;
  userId: string;
  status: string;
  amountKobo: bigint;
}

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

    const resolvedTopup =
      this.normalizeStoredTopupStatus(topup.status) === 'PENDING'
        ? await this.finalizePendingTopup(reference, 'status_poll', { expectedUserId: userId }) ?? topup
        : topup;

    return this.toTopupStatusResponse(resolvedTopup);
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
    const result = await this.korapayService.initiateCheckout({
      amountKobo,
      reference,
      customerEmail: user.email,
    });

    // Create the local pending record only after Korapay has returned a
    // validated checkout URL. This avoids stranding PENDING rows when
    // initialization fails or returns an unusable checkout URL.
    await this.prisma.paymentTopup.create({
      data: {
        reference,
        userId,
        amountKobo: BigInt(amountKobo),
        creditedAmountKobo: BigInt(amountKobo),
        feeBearer: STUDENT_TOPUP_FEE_BEARER,
        status: 'PENDING',
        korapayResponse: {} as Prisma.InputJsonValue,
      },
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

    const reference = this.resolveWebhookReference(data);

    if (event === 'charge.failed') {
      const amountKobo = this.parseMajorAmountToKobo(data.amount, 'webhook');
      const pendingTopup = await this.prisma.paymentTopup.findUnique({
        where: { reference },
        select: { userId: true, status: true, amountKobo: true },
      });

      if (pendingTopup && pendingTopup.status !== 'PENDING') {
        this.logger.log(`Idempotent webhook: reference ${reference} already ${pendingTopup.status}`);
        return { success: true };
      }

      try {
        const webhookFinancials = this.buildTopupFinancialFields(
          pendingTopup?.amountKobo ?? amountKobo,
          undefined,
          validated,
        );

        await this.prisma.paymentTopup.upsert({
          where: { reference },
          update: {
            status: 'FAILED',
            ...webhookFinancials,
            korapayResponse: validated as unknown as Prisma.InputJsonValue,
          },
          create: {
            reference,
            userId: pendingTopup?.userId ?? 'UNKNOWN',
            amountKobo,
            creditedAmountKobo: pendingTopup?.amountKobo ?? amountKobo,
            feeBearer: STUDENT_TOPUP_FEE_BEARER,
            processorFeeKobo: webhookFinancials.processorFeeKobo,
            grossPaidKobo: webhookFinancials.grossPaidKobo,
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

    const finalizedTopup = await this.finalizeSuccessfulWebhookTopup(reference, validated);

    if (!finalizedTopup) {
      this.logger.warn(
        { reference, customerEmail: data.customer?.email },
        'Received top-up success webhook for unknown reference; refusing to credit without a pending top-up record',
      );
    }

    return { success: true };
  }

  private async finalizeSuccessfulWebhookTopup(
    reference: string,
    webhookPayload: KorapayWebhookPayload,
  ): Promise<TopupRecordSnapshot | null> {
    const topup = await this.getTopupSnapshot(reference);
    if (!topup) {
      return null;
    }

    if (this.normalizeStoredTopupStatus(topup.status) !== 'PENDING') {
      return topup;
    }

    // At this point the webhook is signed, schema-valid, event/status-consistent,
    // and references a pending local top-up. We still do not credit from webhook
    // fields alone: final money movement must pass active /charges/:reference
    // verification to avoid trusting webhook-only amount semantics.
    return this.finalizePendingTopup(reference, 'webhook', { webhookPayload });
  }

  private async finalizePendingTopup(
    reference: string,
    source: TopupFinalizationSource,
    options: {
      expectedUserId?: string;
      webhookPayload?: KorapayWebhookPayload;
    } = {},
  ): Promise<TopupRecordSnapshot | null> {
    const topup = await this.getTopupSnapshot(reference);
    if (!topup) {
      return null;
    }

    if (options.expectedUserId && topup.userId !== options.expectedUserId) {
      throw new NotFoundException('topup_not_found');
    }

    if (this.normalizeStoredTopupStatus(topup.status) !== 'PENDING') {
      return topup;
    }

    let verification: KorapayTransactionVerification;
    try {
      verification = await this.korapayService.verifyTransaction(reference);
    } catch (err) {
      if (source !== 'webhook') {
        throw err;
      }

      this.logger.warn(
        { reference, err },
        'Top-up webhook active verification failed; keeping top-up pending',
      );

      await this.prisma.paymentTopup.update({
        where: { reference },
        data: {
          ...this.buildTopupFinancialFields(topup.amountKobo, undefined, options.webhookPayload),
          korapayResponse: {
            source,
            webhook: options.webhookPayload ?? null,
            verification: {
              status: 'verification_error',
              reference,
              amount: null,
              amountPaid: null,
              currency: null,
            },
          } as Prisma.InputJsonValue,
        },
      });

      return topup;
    }
    const normalizedVerificationStatus = this.normalizeKorapayStatus(verification.status);

    if (this.isFailedKorapayStatus(normalizedVerificationStatus)) {
      await this.prisma.paymentTopup.update({
        where: { reference },
        data: {
          status: 'FAILED',
          ...this.buildTopupFinancialFields(topup.amountKobo, verification, options.webhookPayload),
          korapayResponse: this.buildTopupAuditPayload(source, verification, options.webhookPayload) as Prisma.InputJsonValue,
        },
      });

      return {
        ...topup,
        status: 'FAILED',
      };
    }

    if (!this.isSuccessfulKorapayStatus(normalizedVerificationStatus)) {
      await this.prisma.paymentTopup.update({
        where: { reference },
        data: {
          ...this.buildTopupFinancialFields(topup.amountKobo, verification, options.webhookPayload),
          korapayResponse: this.buildTopupAuditPayload(source, verification, options.webhookPayload) as Prisma.InputJsonValue,
        },
      });

      return topup;
    }

    const verifiedCreditAmountKobo = this.extractVerifiedCreditAmountKobo(
      topup.amountKobo,
      verification,
      options.webhookPayload,
    );
    if (verifiedCreditAmountKobo === null) {
      this.logger.error(
        {
          reference,
          expectedAmountKobo: topup.amountKobo.toString(),
          verificationAmount: verification.amount ?? null,
          verificationAmountPaid: verification.amountPaid ?? null,
          verificationFee: verification.fee ?? null,
          verificationTransactionFee: verification.transactionFee ?? null,
          verificationProcessorFee: verification.processorFee ?? null,
          source,
        },
        'Top-up verification amount mismatch; refusing to credit balance',
      );

      await this.prisma.paymentTopup.update({
        where: { reference },
        data: {
          status: 'FAILED',
          ...this.buildTopupFinancialFields(topup.amountKobo, verification, options.webhookPayload),
          korapayResponse: {
            ...this.buildTopupAuditPayload(source, verification, options.webhookPayload),
            internal_failure: 'amount_mismatch',
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ...topup,
        status: 'FAILED',
      };
    }

    return this.creditVerifiedPendingTopup(topup, verifiedCreditAmountKobo, verification, source, options.webhookPayload);
  }

  private async creditVerifiedPendingTopup(
    topup: TopupRecordSnapshot,
    verifiedAmountKobo: bigint,
    verification: KorapayTransactionVerification,
    source: TopupFinalizationSource,
    webhookPayload?: KorapayWebhookPayload,
  ): Promise<TopupRecordSnapshot> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const latestTopup = await tx.paymentTopup.findUnique({
            where: { reference: topup.reference },
            select: {
              reference: true,
              userId: true,
              status: true,
              amountKobo: true,
            },
          });

          if (!latestTopup) {
            throw new Error('Pending top-up missing during transaction');
          }

          if (this.normalizeStoredTopupStatus(latestTopup.status) !== 'PENDING') {
            return latestTopup;
          }

          if (latestTopup.amountKobo !== verifiedAmountKobo) {
            await tx.paymentTopup.update({
              where: { reference: topup.reference },
              data: {
                status: 'FAILED',
                ...this.buildTopupFinancialFields(latestTopup.amountKobo, verification, webhookPayload),
                korapayResponse: {
                  ...this.buildTopupAuditPayload(source, verification, webhookPayload),
                  internal_failure: 'amount_mismatch',
                } as Prisma.InputJsonValue,
              },
            });

            return {
              ...latestTopup,
              status: 'FAILED',
            };
          }

          const freshUser = await tx.user.findUnique({
            where: { id: latestTopup.userId },
            select: { id: true, verifiedBalanceKobo: true },
          });

          if (!freshUser) {
            this.logger.error({ reference: topup.reference, userId: latestTopup.userId }, 'Pending top-up user missing');
            throw new Error('User missing during transaction');
          }

          if (freshUser.verifiedBalanceKobo + verifiedAmountKobo > BigInt(MAX_USER_BALANCE_KOBO)) {
            this.logger.warn(
              {
                reference: topup.reference,
                userId: freshUser.id,
                attemptedAmountKobo: verifiedAmountKobo.toString(),
                currentBalanceKobo: freshUser.verifiedBalanceKobo.toString(),
                source,
              },
              'Top-up failed: balance cap exceeded',
            );

            await tx.paymentTopup.update({
              where: { reference: topup.reference },
              data: {
                status: 'FAILED',
                ...this.buildTopupFinancialFields(latestTopup.amountKobo, verification, webhookPayload),
                korapayResponse: {
                  ...this.buildTopupAuditPayload(source, verification, webhookPayload),
                  internal_failure: 'balance_cap_exceeded',
                } as Prisma.InputJsonValue,
              },
            });

            return {
              ...latestTopup,
              status: 'FAILED',
            };
          }

          const operatingAccount = await tx.user.findUnique({
            where: { id: 'u_operating' },
            select: { id: true, verifiedBalanceKobo: true },
          });

          if (!operatingAccount) {
            throw new Error('Operating account missing');
          }

          const updatedUser = await tx.user.update({
            where: { id: freshUser.id },
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
            where: { reference: topup.reference },
            data: {
              status: 'SUCCESS',
              ...this.buildTopupFinancialFields(verifiedAmountKobo, verification, webhookPayload),
              korapayResponse: this.buildTopupAuditPayload(source, verification, webhookPayload) as Prisma.InputJsonValue,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: topup.reference,
              userId: freshUser.id,
              type: LedgerEntryType.CREDIT,
              amountKobo: verifiedAmountKobo,
              balanceAfterKobo: updatedUser.verifiedBalanceKobo,
              description: `Top-up via Korapay ${topup.reference}`,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: topup.reference,
              userId: 'u_operating',
              type: LedgerEntryType.DEBIT,
              amountKobo: verifiedAmountKobo,
              balanceAfterKobo: updatedOperating.verifiedBalanceKobo,
              description: `Top-up credit to user ${freshUser.id} ${topup.reference}`,
            },
          });

          return {
            ...latestTopup,
            status: 'SUCCESS',
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Idempotent ${source} finalization for reference: ${topup.reference}`);
        const latestTopup = await this.getTopupSnapshot(topup.reference);
        if (latestTopup) {
          return latestTopup;
        }
      }

      this.logger.error(`Transaction failed for ${source} reference ${topup.reference}: ${err}`);
      throw new InternalServerErrorException('Top-up finalization failed');
    }
  }

  private async getTopupSnapshot(reference: string): Promise<TopupRecordSnapshot | null> {
    return this.prisma.paymentTopup.findUnique({
      where: { reference },
      select: {
        reference: true,
        userId: true,
        status: true,
        amountKobo: true,
      },
    });
  }

  private toTopupStatusResponse(topup: Pick<TopupRecordSnapshot, 'reference' | 'status' | 'amountKobo'>): TopupStatusResponse {
    return {
      reference: topup.reference,
      status: this.normalizeStoredTopupStatus(topup.status),
      amountKobo: topup.amountKobo.toString(),
    };
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

  private extractVerifiedCreditAmountKobo(
    pendingAmountKobo: bigint,
    verification: KorapayTransactionVerification,
    webhookPayload?: KorapayWebhookPayload,
  ): bigint | null {
    const verificationAmountKobo = this.parseOptionalMajorAmountToKobo(
      verification.amount,
      'verification amount',
    );
    const amountPaidKobo = this.parseOptionalMajorAmountToKobo(
      verification.amountPaid,
      'verification amount_paid',
    );
    const grossPaidKobo = amountPaidKobo ?? this.extractGrossPaidKoboFromWebhook(webhookPayload);
    const grossAmountCandidateKobo = amountPaidKobo ?? verificationAmountKobo;
    const processorFeeKobo = this.extractProcessorFeeKobo(
      verification,
      webhookPayload,
    );

    // Case 1: Korapay amount is the exact requested Oneto credit.
    if (verificationAmountKobo !== null && verificationAmountKobo === pendingAmountKobo) {
      return pendingAmountKobo;
    }

    // If amount is not the pending credit and Korapay returned both amount and
    // amount_paid, they must agree before we use fee-based fallback checks.
    if (
      verificationAmountKobo !== null &&
      amountPaidKobo !== null &&
      verificationAmountKobo !== amountPaidKobo
    ) {
      return null;
    }

    // Case 2: Gross paid (amount_paid or amount) equals requested credit + fee.
    if (
      processorFeeKobo !== null &&
      grossAmountCandidateKobo !== null &&
      grossAmountCandidateKobo === pendingAmountKobo + processorFeeKobo
    ) {
      return pendingAmountKobo;
    }

    // Case 3: amount_paid - fee equals requested credit.
    if (
      processorFeeKobo !== null &&
      grossPaidKobo !== null &&
      grossPaidKobo >= processorFeeKobo &&
      grossPaidKobo - processorFeeKobo === pendingAmountKobo
    ) {
      return pendingAmountKobo;
    }

    // Fail closed for any unrecognized Korapay amount shape.
    return null;
  }

  private resolveWebhookReference(
    data: Pick<KorapayWebhookPayload['data'], 'reference' | 'payment_reference'>,
  ): string {
    const reference = data.reference?.trim();
    if (reference) {
      return reference;
    }

    const paymentReference = data.payment_reference?.trim();
    if (paymentReference) {
      return paymentReference;
    }

    throw new BadRequestException('Webhook reference is missing');
  }

  private buildTopupAuditPayload(
    source: TopupFinalizationSource,
    verification: KorapayTransactionVerification,
    webhookPayload?: KorapayWebhookPayload,
  ): Record<string, unknown> {
    const creditAmountKobo =
      verification.amount === undefined
        ? null
        : this.parseOptionalMajorAmountToKobo(verification.amount, 'verification amount')?.toString() ?? null;
    const grossPaidKobo =
      this.extractGrossPaidKobo(verification, webhookPayload)?.toString() ?? null;
    const processorFeeKobo =
      this.extractProcessorFeeKobo(
        verification,
        webhookPayload,
      )?.toString() ?? null;

    return {
      source,
      webhook: webhookPayload ?? null,
      verification: {
        status: verification.status,
        reference: verification.reference ?? null,
        amount: verification.amount ?? null,
        amountPaid: verification.amountPaid ?? null,
        fee: verification.fee ?? null,
        transactionFee: verification.transactionFee ?? null,
        processorFee: verification.processorFee ?? null,
        merchantBearsCost: verification.merchantBearsCost ?? null,
        currency: verification.currency ?? null,
      },
      accounting: {
        feeBearer: STUDENT_TOPUP_FEE_BEARER,
        creditAmountKobo,
        grossPaidKobo,
        processorFeeKobo,
      },
    };
  }

  private buildTopupFinancialFields(
    creditedAmountKobo: bigint,
    verification?: KorapayTransactionVerification,
    webhookPayload?: KorapayWebhookPayload,
  ): {
    creditedAmountKobo: bigint;
    feeBearer: TopupFeeBearer;
    processorFeeKobo?: bigint;
    grossPaidKobo?: bigint;
  } {
    const grossPaidKobo = verification
      ? this.extractGrossPaidKobo(verification, webhookPayload)
      : this.extractGrossPaidKoboFromWebhook(webhookPayload);
    const processorFeeKobo = verification
      ? this.extractProcessorFeeKobo(verification, webhookPayload)
      : this.extractProcessorFeeKoboFromWebhook(webhookPayload);

    return {
      creditedAmountKobo,
      feeBearer: STUDENT_TOPUP_FEE_BEARER,
      processorFeeKobo: processorFeeKobo ?? undefined,
      grossPaidKobo: grossPaidKobo ?? undefined,
    };
  }

  private extractGrossPaidKobo(
    verification: KorapayTransactionVerification,
    webhookPayload?: KorapayWebhookPayload,
  ): bigint | null {
    return (
      this.parseOptionalMajorAmountToKobo(verification.amountPaid, 'verification amount_paid') ??
      this.extractGrossPaidKoboFromWebhook(webhookPayload)
    );
  }

  private extractGrossPaidKoboFromWebhook(webhookPayload?: KorapayWebhookPayload): bigint | null {
    return this.parseOptionalMajorAmountToKobo(
      this.readKorapayAmountLikeField(webhookPayload?.data, 'amount_paid'),
      'webhook amount_paid',
    );
  }

  private extractProcessorFeeKobo(
    verification: KorapayTransactionVerification,
    webhookPayload: KorapayWebhookPayload | undefined,
  ): bigint | null {
    const explicitFee =
      this.parseOptionalMajorAmountToKobo(verification.processorFee, 'verification processor_fee') ??
      this.parseOptionalMajorAmountToKobo(verification.transactionFee, 'verification transaction_fee') ??
      this.parseOptionalMajorAmountToKobo(verification.fee, 'verification fee') ??
      this.extractProcessorFeeKoboFromWebhook(webhookPayload);

    if (explicitFee !== null) {
      return explicitFee;
    }

    return null;
  }

  private extractProcessorFeeKoboFromWebhook(
    webhookPayload: KorapayWebhookPayload | undefined,
  ): bigint | null {
    const data = webhookPayload?.data;
    const explicitFee =
      this.parseOptionalMajorAmountToKobo(
        this.readKorapayAmountLikeField(data, 'processor_fee'),
        'webhook processor_fee',
      ) ??
      this.parseOptionalMajorAmountToKobo(
        this.readKorapayAmountLikeField(data, 'transaction_fee'),
        'webhook transaction_fee',
      ) ??
      this.parseOptionalMajorAmountToKobo(this.readKorapayAmountLikeField(data, 'fee'), 'webhook fee');

    return explicitFee;
  }

  private parseOptionalMajorAmountToKobo(
    amount: string | number | undefined | null,
    source: string,
  ): bigint | null {
    if (amount === undefined || amount === null) {
      return null;
    }

    const raw = typeof amount === 'number' ? amount.toString() : amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      this.logger.warn({ source, amount }, 'Ignoring invalid optional Korapay amount field');
      return null;
    }

    const [wholePart, decimalPart = ''] = raw.split('.');
    const parsed = BigInt(`${wholePart}${decimalPart.padEnd(2, '0')}`);
    return parsed >= BigInt(0) ? parsed : null;
  }

  private readKorapayAmountLikeField(
    data: KorapayWebhookPayload['data'] | undefined,
    field: string,
  ): string | number | undefined {
    if (!data) {
      return undefined;
    }

    const value = (data as Record<string, unknown>)[field];
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }

    return undefined;
  }
}
