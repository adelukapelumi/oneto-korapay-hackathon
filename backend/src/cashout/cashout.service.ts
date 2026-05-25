import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayGatewayError, KorapayService } from '../topup/korapay.service';
import { Prisma, CashoutStatus, KorapayPayoutFeeBearer, LedgerEntryType } from '@prisma/client';
import * as crypto from 'crypto';
import { z } from 'zod';
import { MIN_CASHOUT_GROSS_KOBO, MIN_KORAPAY_TRANSFER_KOBO } from '@oneto/shared';
import { tryNormalizeEmail } from '../common/email';

const ONETO_SERVICE_FEE_BPS = 250;
const BASIS_POINTS_DIVISOR = 10_000n;

const PayoutWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    reason: z.string().optional(),
  }).passthrough(),
}).passthrough();

type PayoutWebhookPayload = z.infer<typeof PayoutWebhookSchema>;

type CashoutAccountingInput = {
  readonly grossAmountKobo: bigint;
  readonly onetoFeeBps: number;
  readonly onetoFeeKobo: bigint;
  readonly korapayPayoutFeeKobo: bigint | null;
  readonly korapayPayoutFeeBearer: KorapayPayoutFeeBearer;
  readonly korapayPayoutFeeDeductedFromRecipient: boolean | null;
  readonly netPayoutKobo: bigint | null;
  readonly korapayTransferAmountKobo: bigint | null;
};

type PayoutFeeAccountingInput = {
  readonly grossAmountKobo: bigint;
  readonly onetoFeeKobo: bigint;
  readonly korapayTransferAmountKobo: bigint | null;
  readonly korapayPayoutFeeKobo: bigint | null;
  readonly existingFeeBearer?: KorapayPayoutFeeBearer | null;
  readonly existingDeductedFromRecipient?: boolean | null;
  readonly gatewayPayload?: unknown;
};

type PayoutFeeAccountingResult = {
  readonly korapayPayoutFeeBearer: KorapayPayoutFeeBearer;
  readonly korapayPayoutFeeDeductedFromRecipient: boolean | null;
  readonly netPayoutKobo: bigint | null;
};

class CashoutPayoutPreconditionError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(code: string, context: Record<string, unknown>) {
    super(code);
    this.name = 'CashoutPayoutPreconditionError';
    this.code = code;
    this.context = context;
  }
}

@Injectable()
export class CashoutService {
  private readonly logger = new Logger(CashoutService.name);
  private readonly OPERATING_USER_ID = 'u_operating';
  private readonly MIN_CASHOUT_GROSS_KOBO = BigInt(MIN_CASHOUT_GROSS_KOBO);
  private readonly MIN_KORAPAY_TRANSFER_KOBO = BigInt(MIN_KORAPAY_TRANSFER_KOBO);

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
  ) {
    // Periodically recover stuck cashouts that never reached terminal state
    setInterval(() => this.recoverStuckCashouts(), 5 * 60 * 1000).unref();
  }

  private calculateOnetoFeeKobo(grossAmountKobo: bigint): bigint {
    return (grossAmountKobo * BigInt(ONETO_SERVICE_FEE_BPS)) / BASIS_POINTS_DIVISOR;
  }

  private calculateNetPayoutKobo(input: {
    readonly grossAmountKobo: bigint;
    readonly onetoFeeKobo: bigint;
    readonly korapayTransferAmountKobo: bigint | null;
    readonly korapayPayoutFeeKobo: bigint | null;
    readonly korapayPayoutFeeBearer: KorapayPayoutFeeBearer;
    readonly korapayPayoutFeeDeductedFromRecipient: boolean | null;
  }): bigint | null {
    if (
      input.korapayPayoutFeeBearer === KorapayPayoutFeeBearer.MERCHANT &&
      input.korapayPayoutFeeDeductedFromRecipient === true &&
      input.korapayPayoutFeeKobo !== null
    ) {
      const netPayoutKobo =
        input.grossAmountKobo - input.onetoFeeKobo - input.korapayPayoutFeeKobo;
      return netPayoutKobo >= 0n ? netPayoutKobo : null;
    }

    if (input.korapayPayoutFeeBearer === KorapayPayoutFeeBearer.ONETO) {
      return input.korapayTransferAmountKobo;
    }

    return null;
  }

  private hasRecipientFeeDeductionProof(payload: unknown): boolean {
    const parsed = z
      .object({
        data: z.unknown().optional(),
        fee_deducted_from_recipient: z.boolean().optional(),
        feeDeductedFromRecipient: z.boolean().optional(),
        payout_fee_deducted_from_recipient: z.boolean().optional(),
        payoutFeeDeductedFromRecipient: z.boolean().optional(),
        recipient_bears_fee: z.boolean().optional(),
        recipientBearsFee: z.boolean().optional(),
      })
      .passthrough()
      .safeParse(payload);

    if (!parsed.success) {
      return false;
    }

    if (
      parsed.data.fee_deducted_from_recipient === true ||
      parsed.data.feeDeductedFromRecipient === true ||
      parsed.data.payout_fee_deducted_from_recipient === true ||
      parsed.data.payoutFeeDeductedFromRecipient === true ||
      parsed.data.recipient_bears_fee === true ||
      parsed.data.recipientBearsFee === true
    ) {
      return true;
    }

    if (parsed.data.data && parsed.data.data !== payload) {
      return this.hasRecipientFeeDeductionProof(parsed.data.data);
    }

    return false;
  }

  private resolvePayoutFeeAccounting(input: PayoutFeeAccountingInput): PayoutFeeAccountingResult {
    const hasDeductionProof = this.hasRecipientFeeDeductionProof(input.gatewayPayload);
    const existingFeeBearer =
      input.existingFeeBearer ?? KorapayPayoutFeeBearer.UNKNOWN;
    const existingDeductedFromRecipient =
      input.existingDeductedFromRecipient ?? null;

    const korapayPayoutFeeBearer =
      input.korapayPayoutFeeKobo === null
        ? existingFeeBearer
        : hasDeductionProof
          ? KorapayPayoutFeeBearer.MERCHANT
          : KorapayPayoutFeeBearer.ONETO;

    const korapayPayoutFeeDeductedFromRecipient =
      input.korapayPayoutFeeKobo === null
        ? existingDeductedFromRecipient
        : hasDeductionProof;

    return {
      korapayPayoutFeeBearer,
      korapayPayoutFeeDeductedFromRecipient,
      netPayoutKobo: this.calculateNetPayoutKobo({
        grossAmountKobo: input.grossAmountKobo,
        onetoFeeKobo: input.onetoFeeKobo,
        korapayTransferAmountKobo: input.korapayTransferAmountKobo,
        korapayPayoutFeeKobo: input.korapayPayoutFeeKobo,
        korapayPayoutFeeBearer,
        korapayPayoutFeeDeductedFromRecipient,
      }),
    };
  }

  private getGrossAmountKobo(cashout: { amountKobo: bigint; grossAmountKobo?: bigint | null }): bigint {
    return cashout.grossAmountKobo ?? cashout.amountKobo;
  }

  private buildCashoutAccountingPayload(input: CashoutAccountingInput): Prisma.InputJsonValue {
    return {
      kind: 'merchant_cashout_accounting',
      grossAmountKobo: input.grossAmountKobo.toString(),
      onetoFeeBps: input.onetoFeeBps,
      onetoFeeKobo: input.onetoFeeKobo.toString(),
      korapayPayoutFeeKobo: input.korapayPayoutFeeKobo?.toString() ?? null,
      korapayPayoutFeeBearer: input.korapayPayoutFeeBearer,
      korapayPayoutFeeDeductedFromRecipient: input.korapayPayoutFeeDeductedFromRecipient,
      netPayoutKobo: input.netPayoutKobo?.toString() ?? null,
      korapayTransferAmountKobo: input.korapayTransferAmountKobo?.toString() ?? null,
    };
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return { serializationError: 'korapay_payload_not_json_serializable' };
    }
  }

  private toSafeNumberKobo(amountKobo: bigint): number {
    const amount = Number(amountKobo);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error('cashout_amount_out_of_safe_number_range');
    }
    return amount;
  }

  private assertCashoutMinimums(input: {
    readonly grossAmountKobo: bigint;
    readonly korapayTransferAmountKobo: bigint;
  }): void {
    if (input.grossAmountKobo < this.MIN_CASHOUT_GROSS_KOBO) {
      throw new BadRequestException('cashout_gross_below_minimum');
    }

    if (input.korapayTransferAmountKobo < this.MIN_KORAPAY_TRANSFER_KOBO) {
      throw new BadRequestException('cashout_transfer_below_gateway_minimum');
    }
  }

  private buildKorapayErrorDiagnostics(error: unknown): {
    readonly failureReason: string;
    readonly diagnostics: Prisma.InputJsonValue;
  } {
    if (error instanceof CashoutPayoutPreconditionError) {
      return {
        failureReason: 'payout_merchant_email_invalid',
        diagnostics: this.toJsonValue({
          errorType: 'payout_precondition_error',
          code: error.code,
          context: error.context,
        }),
      };
    }

    if (error instanceof KorapayGatewayError) {
      const failureReason = this.classifyKorapayFailureReason(error);
      return {
        failureReason,
        diagnostics: this.toJsonValue({
          errorType: 'korapay_gateway_error',
          category: error.category,
          statusCode: error.statusCode,
          message: error.message,
          responseBody: error.responseBody,
        }),
      };
    }

    return {
      failureReason: 'payout_gateway_error',
      diagnostics: this.toJsonValue({
        errorType: 'payout_initiation_error',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  private classifyKorapayFailureReason(error: KorapayGatewayError): string {
    if (error.category === 'network_error') {
      return 'payout_gateway_error';
    }

    const statusCode = error.statusCode ?? 0;
    const bodyText =
      typeof error.responseBody === 'string'
        ? error.responseBody.toLowerCase()
        : JSON.stringify(error.responseBody).toLowerCase();

    const containsAny = (...keywords: readonly string[]) =>
      keywords.some((keyword) => bodyText.includes(keyword));

    if (
      containsAny('insufficient balance', 'insufficient fund', 'insufficient wallet') ||
      statusCode === 402
    ) {
      return 'payout_gateway_insufficient_balance';
    }

    if (
      containsAny('minimum', 'below minimum', 'too small') ||
      statusCode === 416
    ) {
      return 'payout_gateway_minimum_amount';
    }

    if (
      containsAny('invalid account', 'account number', 'invalid bank', 'bank code', 'beneficiary')
    ) {
      return 'payout_gateway_invalid_bank_account';
    }

    if (statusCode >= 400 && statusCode < 500) {
      return 'payout_gateway_rejected';
    }

    return 'payout_gateway_error';
  }

  async recoverStuckCashouts() {
    try {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const stuckCashouts = await this.prisma.cashout.findMany({
        where: {
          status: CashoutStatus.PROCESSING,
          approvedAt: { lt: fiveMinsAgo },
        },
      });

      for (const cashout of stuckCashouts) {
        if (!cashout.korapayReference) continue;

        // Korapay /charges/:reference is the pay-in verification path. A payout
        // reference can legitimately be missing there even if the transfer
        // succeeded, so using that endpoint here could refund a merchant after
        // Oneto has already paid them. Until a payout-specific verification
        // endpoint is wired and tested, webhooks are the source of truth and
        // stuck PROCESSING cashouts remain PROCESSING for manual review.
        this.logger.warn(
          {
            cashoutId: cashout.id,
            korapayReference: cashout.korapayReference,
          },
          'Cashout payout recovery skipped: payout verification endpoint is not configured',
        );
      }
    } catch (err) {
      this.logger.error('Error in recoverStuckCashouts sweep:', err);
    }
  }

  async requestCashout(merchantUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: merchantUserId },
      include: { merchantProfile: true },
    });

    if (!user || user.role !== 'MERCHANT') {
      throw new ForbiddenException('Only merchants can request cashout');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is restricted');
    }

    if (!user.merchantProfile) {
      throw new BadRequestException('merchant_profile_missing');
    }

    if (user.merchantProfile.verifiedAt === null) {
      throw new ForbiddenException('merchant_not_approved');
    }

    const grossAmountKobo = user.verifiedBalanceKobo;
    const onetoFeeKobo = this.calculateOnetoFeeKobo(grossAmountKobo);
    const korapayTransferAmountKobo = grossAmountKobo - onetoFeeKobo;
    this.assertCashoutMinimums({
      grossAmountKobo,
      korapayTransferAmountKobo,
    });

    const existingCashout = await this.prisma.cashout.findFirst({
      where: {
        merchantUserId,
        status: { in: [CashoutStatus.PENDING, CashoutStatus.APPROVED, CashoutStatus.PROCESSING] },
      },
    });

    if (existingCashout) {
      throw new ConflictException('cashout_in_progress');
    }

    return this.prisma.cashout.create({
      data: {
        merchantUserId,
        amountKobo: grossAmountKobo,
        grossAmountKobo,
        onetoFeeBps: ONETO_SERVICE_FEE_BPS,
        onetoFeeKobo,
        korapayPayoutFeeKobo: null,
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
        korapayPayoutFeeDeductedFromRecipient: null,
        netPayoutKobo: null,
        korapayTransferAmountKobo,
        status: CashoutStatus.PENDING,
        cashoutBankName: user.merchantProfile.cashoutBankName,
        cashoutBankCode: user.merchantProfile.cashoutBankCode,
        cashoutAccountNumber: user.merchantProfile.cashoutAccountNumber,
        cashoutAccountName: user.merchantProfile.cashoutAccountName,
      },
    });
  }

  async approveCashout(cashoutId: string, adminUserId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can approve cashouts');
    }

    const korapayReference = `cashout_${crypto.randomBytes(12).toString('hex')}`;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 1. Atomic status update: PENDING -> PROCESSING
          // The WHERE clause ensures only one admin can approve a pending request.
          // If status is already changed (e.g. by another admin), update throws P2025.
          const cashout = await tx.cashout.update({
            where: {
              id: cashoutId,
              status: CashoutStatus.PENDING,
            },
            data: {
              status: CashoutStatus.PROCESSING,
              approvedAt: new Date(),
              approvedByUserId: adminUserId,
              korapayReference,
            },
          });

          const grossAmountKobo = this.getGrossAmountKobo(cashout);
          const onetoFeeBps = cashout.onetoFeeBps ?? ONETO_SERVICE_FEE_BPS;
          const onetoFeeKobo = cashout.onetoFeeKobo ?? this.calculateOnetoFeeKobo(grossAmountKobo);
          const korapayTransferAmountKobo =
            cashout.korapayTransferAmountKobo ?? (grossAmountKobo - onetoFeeKobo);
          this.assertCashoutMinimums({
            grossAmountKobo,
            korapayTransferAmountKobo,
          });
          const korapayPayoutFeeKobo = cashout.korapayPayoutFeeKobo ?? null;
          const feeAccounting = this.resolvePayoutFeeAccounting({
            grossAmountKobo,
            onetoFeeKobo,
            korapayPayoutFeeKobo,
            korapayTransferAmountKobo,
            existingFeeBearer: cashout.korapayPayoutFeeBearer,
            existingDeductedFromRecipient: cashout.korapayPayoutFeeDeductedFromRecipient,
          });

          await tx.cashout.update({
            where: { id: cashout.id },
            data: {
              amountKobo: grossAmountKobo,
              grossAmountKobo,
              onetoFeeBps,
              onetoFeeKobo,
              korapayTransferAmountKobo,
              korapayPayoutFeeBearer: feeAccounting.korapayPayoutFeeBearer,
              korapayPayoutFeeDeductedFromRecipient:
                feeAccounting.korapayPayoutFeeDeductedFromRecipient,
              netPayoutKobo: feeAccounting.netPayoutKobo,
            },
          });

          // 2. Fetch merchant and check balance
          const merchant = await tx.user.findUnique({
            where: { id: cashout.merchantUserId },
          });

          if (!merchant) {
            throw new Error('merchant_not_found');
          }

          if (merchant.verifiedBalanceKobo < grossAmountKobo) {
            throw new Error('insufficient_balance');
          }

          // 3. Fetch operating account
          const operatingAccount = await tx.user.findUnique({
            where: { id: this.OPERATING_USER_ID },
          });

          if (!operatingAccount) {
            throw new Error('operating_account_missing');
          }

          // 4. Debit merchant by the full gross settled balance.
          const accountingPayload = this.buildCashoutAccountingPayload({
            grossAmountKobo,
            onetoFeeBps,
            onetoFeeKobo,
            korapayPayoutFeeKobo,
            korapayPayoutFeeBearer: feeAccounting.korapayPayoutFeeBearer,
            korapayPayoutFeeDeductedFromRecipient:
              feeAccounting.korapayPayoutFeeDeductedFromRecipient,
            netPayoutKobo: feeAccounting.netPayoutKobo,
            korapayTransferAmountKobo,
          });
          const newMerchantBalance = merchant.verifiedBalanceKobo - grossAmountKobo;
          await tx.user.update({
            where: { id: merchant.id },
            data: { verifiedBalanceKobo: newMerchantBalance },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: korapayReference,
              userId: merchant.id,
              type: LedgerEntryType.DEBIT,
              amountKobo: grossAmountKobo,
              balanceAfterKobo: newMerchantBalance,
              description: `Cashout gross debit ${korapayReference} with Oneto service fee recorded`,
              envelopeJson: accountingPayload,
            },
          });

          // 5. Credit operating account
          const newOperatingBalance = operatingAccount.verifiedBalanceKobo + grossAmountKobo;
          await tx.user.update({
            where: { id: operatingAccount.id },
            data: { verifiedBalanceKobo: newOperatingBalance },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: korapayReference,
              userId: operatingAccount.id,
              type: LedgerEntryType.CREDIT,
              amountKobo: grossAmountKobo,
              balanceAfterKobo: newOperatingBalance,
              description: `Cashout gross credit from merchant ${merchant.id} with Oneto service fee recorded`,
              envelopeJson: accountingPayload,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new BadRequestException('Cashout is not in PENDING status or does not exist');
      }
      if (err instanceof Error && err.message === 'insufficient_balance') {
        throw new BadRequestException('insufficient_balance_for_cashout');
      }
      if (err instanceof Error && (err.message === 'operating_account_missing' || err.message === 'merchant_not_found')) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Only reached if transaction committed successfully.
    await this.initiateKorapayPayout(cashoutId, korapayReference);

    const latestCashout = await this.prisma.cashout.findUnique({
      where: { id: cashoutId },
      select: {
        status: true,
        failureReason: true,
      },
    });

    return {
      success: true,
      status: latestCashout?.status ?? CashoutStatus.PROCESSING,
      failureReason: latestCashout?.failureReason ?? null,
    };
  }

  private async initiateKorapayPayout(cashoutId: string, korapayReference: string) {
    const cashout = await this.prisma.cashout.findUnique({
      where: { id: cashoutId },
      include: {
        merchant: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!cashout || cashout.status !== CashoutStatus.PROCESSING) {
      return;
    }

    const grossAmountKobo = this.getGrossAmountKobo(cashout);
    const onetoFeeKobo = cashout.onetoFeeKobo ?? this.calculateOnetoFeeKobo(grossAmountKobo);
    const korapayTransferAmountKobo =
      cashout.korapayTransferAmountKobo ?? (grossAmountKobo - onetoFeeKobo);

    try {
      const merchantEmail = tryNormalizeEmail(cashout.merchant?.email ?? '');
      if (merchantEmail === null) {
        throw new CashoutPayoutPreconditionError('merchant_email_missing_or_invalid', {
          cashoutId,
          merchantUserId: cashout.merchantUserId,
        });
      }

      // Korapay's documented payout response can return a fee after payout
      // initiation, but we do not currently have a documented fee quote before
      // transfer initiation. Approval therefore cannot display an exact final
      // merchant receivable. We send gross minus Oneto's 2.5% fee to Korapay
      // and keep netPayoutKobo unknown while the fee bearer is unknown.
      //
      // A returned Korapay fee is not proof the merchant paid it. Until Kora
      // gives explicit recipient-deduction proof, reported payout fees are
      // stored as Oneto processor expense/audit data. TODO: switch to
      // merchant-borne payout fees only after Kora fee deduction is technically
      // confirmed or a fee quote is known before payout and subtracted here.
      const payoutResult = await this.korapayService.initiatePayout({
        reference: korapayReference,
        amountKobo: this.toSafeNumberKobo(korapayTransferAmountKobo),
        bankCode: cashout.cashoutBankCode,
        accountNumber: cashout.cashoutAccountNumber,
        accountName: cashout.cashoutAccountName,
        customerName: cashout.cashoutAccountName,
        customerEmail: merchantEmail,
        narration: `Cashout ${korapayReference}`,
      });

      const korapayPayoutFeeKobo = payoutResult.payoutFeeKobo ?? cashout.korapayPayoutFeeKobo ?? null;
      const feeAccounting = this.resolvePayoutFeeAccounting({
        grossAmountKobo,
        onetoFeeKobo,
        korapayTransferAmountKobo,
        korapayPayoutFeeKobo,
        existingFeeBearer: cashout.korapayPayoutFeeBearer,
        existingDeductedFromRecipient: cashout.korapayPayoutFeeDeductedFromRecipient,
        gatewayPayload: payoutResult.rawResponse,
      });
      await this.prisma.cashout.update({
        where: { id: cashoutId },
        data: {
          korapayResponse: this.toJsonValue(payoutResult.rawResponse),
          korapayPayoutFeeKobo,
          korapayTransferAmountKobo,
          korapayPayoutFeeBearer: feeAccounting.korapayPayoutFeeBearer,
          korapayPayoutFeeDeductedFromRecipient:
            feeAccounting.korapayPayoutFeeDeductedFromRecipient,
          netPayoutKobo: feeAccounting.netPayoutKobo,
        },
      });
    } catch (error: unknown) {
      const diagnostics = this.buildKorapayErrorDiagnostics(error);
      this.logger.error(
        `Korapay payout initiation failed for ${cashoutId}: ${diagnostics.failureReason}`,
      );

      // Manual reversal of balance reservation since Korapay initiation failed immediately.
      // This pattern remains to ensure ledger consistency.
      await this.prisma.$transaction(
        async (tx) => {
          const transition = await tx.cashout.updateMany({
            where: { id: cashoutId, status: CashoutStatus.PROCESSING },
            data: {
              status: CashoutStatus.FAILED,
              failureReason: diagnostics.failureReason,
              korapayResponse: diagnostics.diagnostics,
            },
          });

          // Duplicate invocation or already-terminal state: do not refund twice.
          if (transition.count === 0) {
            return;
          }

          const merchant = await tx.user.findUnique({ where: { id: cashout.merchantUserId } });
          const operating = await tx.user.findUnique({ where: { id: this.OPERATING_USER_ID } });

          if (merchant && operating) {
            const reverseRef = `${korapayReference}_rev`;

            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: merchant.id,
                type: LedgerEntryType.CREDIT,
                amountKobo: grossAmountKobo,
                balanceAfterKobo: merchant.verifiedBalanceKobo + grossAmountKobo,
                description: `Cashout reversal ${korapayReference}`,
              },
            });
            await tx.user.update({
              where: { id: merchant.id },
              data: { verifiedBalanceKobo: { increment: grossAmountKobo } },
            });

            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: operating.id,
                type: LedgerEntryType.DEBIT,
                amountKobo: grossAmountKobo,
                balanceAfterKobo: operating.verifiedBalanceKobo - grossAmountKobo,
                description: `Cashout reversal to merchant ${merchant.id}`,
              },
            });
            await tx.user.update({
              where: { id: operating.id },
              data: { verifiedBalanceKobo: { decrement: grossAmountKobo } },
            });
          }
        },
        { isolationLevel: 'Serializable' },
      );
    }
  }

  async handlePayoutWebhook(payload: unknown, signature: string) {
    const parsedPayload = PayoutWebhookSchema.safeParse(payload);
    if (!parsedPayload.success) {
      throw new BadRequestException('invalid_payout_webhook_payload');
    }

    const webhookPayload: PayoutWebhookPayload = parsedPayload.data;
    const isValid = this.korapayService.verifyWebhookSignature(webhookPayload.data, signature);
    if (!isValid) {
      throw new ForbiddenException('Invalid signature');
    }

    const reference = webhookPayload.data.reference;
    const event = webhookPayload.event;

    // Fix 3: Webhook event spoofing protection
    const eventStatusMap: Record<string, string> = {
      'transfer.success': 'success',
      'transfer.failed': 'failed',
    };
    const expectedDataStatus = eventStatusMap[event];
    if (expectedDataStatus && webhookPayload.data.status !== expectedDataStatus) {
      this.logger.warn({ event, dataStatus: webhookPayload.data.status }, 'Webhook event/status mismatch');
      return { success: true }; // return 200 to stop Korapay retries, but don't process
    }

    const cashout = await this.prisma.cashout.findUnique({
      where: { korapayReference: reference },
    });

    if (!cashout) {
      this.logger.warn(`Unknown korapay reference received: ${reference}`);
      return { success: true };
    }

    if (event === 'transfer.success') {
      const grossAmountKobo = this.getGrossAmountKobo(cashout);
      const onetoFeeKobo = cashout.onetoFeeKobo ?? this.calculateOnetoFeeKobo(grossAmountKobo);
      const korapayTransferAmountKobo =
        cashout.korapayTransferAmountKobo ?? (grossAmountKobo - onetoFeeKobo);
      const feeFromGateway = this.korapayService.extractPayoutFeeKobo(webhookPayload.data);
      const korapayPayoutFeeKobo = feeFromGateway ?? cashout.korapayPayoutFeeKobo ?? null;
      const feeAccounting = this.resolvePayoutFeeAccounting({
        grossAmountKobo,
        onetoFeeKobo,
        korapayTransferAmountKobo,
        korapayPayoutFeeKobo,
        existingFeeBearer: cashout.korapayPayoutFeeBearer,
        existingDeductedFromRecipient: cashout.korapayPayoutFeeDeductedFromRecipient,
        gatewayPayload: webhookPayload.data,
      });
      // Atomic state transition: PROCESSING -> COMPLETED.
      // If count is 0, webhook is duplicate/out-of-order and becomes a no-op.
      await this.prisma.cashout.updateMany({
        where: { id: cashout.id, status: CashoutStatus.PROCESSING },
        data: {
          status: CashoutStatus.COMPLETED,
          completedAt: new Date(),
          korapayResponse: this.toJsonValue(webhookPayload),
          korapayPayoutFeeKobo,
          korapayPayoutFeeBearer: feeAccounting.korapayPayoutFeeBearer,
          korapayPayoutFeeDeductedFromRecipient:
            feeAccounting.korapayPayoutFeeDeductedFromRecipient,
          korapayTransferAmountKobo,
          netPayoutKobo: feeAccounting.netPayoutKobo,
        },
      });
    } else if (event === 'transfer.failed') {
      await this.prisma.$transaction(
        async (tx) => {
          const grossAmountKobo = this.getGrossAmountKobo(cashout);
          // Atomic state transition: PROCESSING -> FAILED.
          // Only the first matching webhook is allowed to run refund side-effects.
          const transition = await tx.cashout.updateMany({
            where: { id: cashout.id, status: CashoutStatus.PROCESSING },
            data: {
              status: CashoutStatus.FAILED,
              failureReason: webhookPayload.data.reason || 'payout_failed_at_gateway',
              korapayResponse: this.toJsonValue(webhookPayload),
            },
          });

          // Duplicate or already-terminal webhook: idempotent no-op.
          if (transition.count === 0) {
            return;
          }

          const merchant = await tx.user.findUnique({ where: { id: cashout.merchantUserId } });
          const operating = await tx.user.findUnique({ where: { id: this.OPERATING_USER_ID } });

          if (merchant && operating) {
            const reverseRef = `${reference}_webhook_fail`;
            
            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: merchant.id,
                type: LedgerEntryType.CREDIT,
                amountKobo: grossAmountKobo,
                balanceAfterKobo: merchant.verifiedBalanceKobo + grossAmountKobo,
                description: `Cashout failure refund ${reference}`,
              },
            });
            await tx.user.update({
              where: { id: merchant.id },
              data: { verifiedBalanceKobo: { increment: grossAmountKobo } },
            });

            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: operating.id,
                type: LedgerEntryType.DEBIT,
                amountKobo: grossAmountKobo,
                balanceAfterKobo: operating.verifiedBalanceKobo - grossAmountKobo,
                description: `Cashout failure reversal from merchant ${merchant.id}`,
              },
            });
            await tx.user.update({
              where: { id: operating.id },
              data: { verifiedBalanceKobo: { decrement: grossAmountKobo } },
            });
          }
        },
        { isolationLevel: 'Serializable' },
      );
    }

    return { success: true };
  }

  async getRecentCashouts(merchantUserId: string) {
    return this.prisma.cashout.findMany({
      where: { merchantUserId },
      orderBy: { requestedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amountKobo: true,
        grossAmountKobo: true,
        onetoFeeBps: true,
        onetoFeeKobo: true,
        korapayPayoutFeeKobo: true,
        korapayPayoutFeeBearer: true,
        korapayPayoutFeeDeductedFromRecipient: true,
        netPayoutKobo: true,
        korapayTransferAmountKobo: true,
        status: true,
        requestedAt: true,
        completedAt: true,
        failureReason: true,
        cashoutBankName: true,
        cashoutBankCode: true,
        cashoutAccountNumber: true,
      },
    });
  }
}
