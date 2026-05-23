import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService } from '../topup/korapay.service';
import { Prisma, CashoutStatus, LedgerEntryType } from '@prisma/client';
import * as crypto from 'crypto';
import { z } from 'zod';

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
  readonly netPayoutKobo: bigint | null;
  readonly payoutAmountBeforeKorapayFeeKobo: bigint | null;
};

@Injectable()
export class CashoutService {
  private readonly logger = new Logger(CashoutService.name);
  private readonly OPERATING_USER_ID = 'u_operating';
  private readonly MIN_CASHOUT_KOBO = 1000n; // 10 NGN

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

  private calculateNetPayoutKobo(
    grossAmountKobo: bigint,
    onetoFeeKobo: bigint,
    korapayPayoutFeeKobo: bigint | null,
  ): bigint | null {
    if (korapayPayoutFeeKobo === null) {
      return null;
    }

    const netPayoutKobo = grossAmountKobo - onetoFeeKobo - korapayPayoutFeeKobo;
    return netPayoutKobo >= 0n ? netPayoutKobo : null;
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
      netPayoutKobo: input.netPayoutKobo?.toString() ?? null,
      payoutAmountBeforeKorapayFeeKobo: input.payoutAmountBeforeKorapayFeeKobo?.toString() ?? null,
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

        try {
          const verification = await this.korapayService.verifyTransaction(cashout.korapayReference);
          const grossAmountKobo = this.getGrossAmountKobo(cashout);
          
          if (verification.status === 'success') {
            const feeFromGateway = this.korapayService.extractPayoutFeeKobo(verification);
            const korapayPayoutFeeKobo = feeFromGateway ?? cashout.korapayPayoutFeeKobo ?? null;
            const onetoFeeKobo = cashout.onetoFeeKobo ?? this.calculateOnetoFeeKobo(grossAmountKobo);
            await this.prisma.cashout.updateMany({
              where: { id: cashout.id, status: CashoutStatus.PROCESSING },
              data: {
                status: CashoutStatus.COMPLETED,
                completedAt: new Date(),
                korapayPayoutFeeKobo,
                netPayoutKobo: this.calculateNetPayoutKobo(
                  grossAmountKobo,
                  onetoFeeKobo,
                  korapayPayoutFeeKobo,
                ),
              },
            });
          } else if (verification.status === 'failed' || verification.status === 'not_found') {
            await this.prisma.$transaction(
              async (tx) => {
                const transition = await tx.cashout.updateMany({
                  where: { id: cashout.id, status: CashoutStatus.PROCESSING },
                  data: {
                    status: CashoutStatus.FAILED,
                    failureReason: verification.status === 'not_found' ? 'payout_initiation_failed_never_reached_gateway' : 'payout_failed_at_gateway_recovered',
                  },
                });

                if (transition.count === 0) return;

                const merchant = await tx.user.findUnique({ where: { id: cashout.merchantUserId } });
                const operating = await tx.user.findUnique({ where: { id: this.OPERATING_USER_ID } });

                if (merchant && operating) {
                  const reverseRef = `${cashout.korapayReference}_recovery_fail`;

                  await tx.ledgerEntry.create({
                    data: {
                      transactionId: reverseRef,
                      userId: merchant.id,
                      type: LedgerEntryType.CREDIT,
                      amountKobo: grossAmountKobo,
                      balanceAfterKobo: merchant.verifiedBalanceKobo + grossAmountKobo,
                      description: `Cashout recovery refund ${cashout.korapayReference}`,
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
                      description: `Cashout recovery reversal from merchant ${merchant.id}`,
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
        } catch (err) {
          this.logger.error(`Failed to recover stuck cashout ${cashout.id}:`, err);
        }
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
    if (grossAmountKobo < this.MIN_CASHOUT_KOBO) {
      throw new BadRequestException('insufficient_balance_for_cashout');
    }

    const onetoFeeKobo = this.calculateOnetoFeeKobo(grossAmountKobo);

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
        netPayoutKobo: null,
        payoutAmountBeforeKorapayFeeKobo: null,
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
          const payoutAmountBeforeKorapayFeeKobo =
            cashout.payoutAmountBeforeKorapayFeeKobo ?? (grossAmountKobo - onetoFeeKobo);
          const korapayPayoutFeeKobo = cashout.korapayPayoutFeeKobo ?? null;
          const netPayoutKobo = this.calculateNetPayoutKobo(
            grossAmountKobo,
            onetoFeeKobo,
            korapayPayoutFeeKobo,
          );

          await tx.cashout.update({
            where: { id: cashout.id },
            data: {
              amountKobo: grossAmountKobo,
              grossAmountKobo,
              onetoFeeBps,
              onetoFeeKobo,
              payoutAmountBeforeKorapayFeeKobo,
              netPayoutKobo,
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
            netPayoutKobo,
            payoutAmountBeforeKorapayFeeKobo,
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
    // Fire-and-forget Korapay call.
    this.initiateKorapayPayout(cashoutId, korapayReference).catch((err) => {
      this.logger.error(`Async Korapay payout initiation failed for ${cashoutId}: ${err.message}`);
    });

    return { success: true };
  }

  private async initiateKorapayPayout(cashoutId: string, korapayReference: string) {
    const cashout = await this.prisma.cashout.findUnique({
      where: { id: cashoutId },
    });

    if (!cashout || cashout.status !== CashoutStatus.PROCESSING) {
      return;
    }

    const grossAmountKobo = this.getGrossAmountKobo(cashout);
    const onetoFeeKobo = cashout.onetoFeeKobo ?? this.calculateOnetoFeeKobo(grossAmountKobo);
    const payoutAmountBeforeKorapayFeeKobo =
      cashout.payoutAmountBeforeKorapayFeeKobo ?? (grossAmountKobo - onetoFeeKobo);

    try {
      // Payout-fee policy assumption for the pilot:
      // Payout-fee policy assumption for the pilot:
      // Korapay's documented payout response can return a fee after payout
      // initiation, but we do not currently have a documented fee quote before
      // transfer initiation. Approval therefore cannot display an exact final
      // merchant receivable. We send gross minus Oneto's 2.5% fee to Korapay
      // and calculate netPayoutKobo only after Korapay returns a fee.
      //
      // This treats the Korapay payout fee as merchant-borne only under the
      // operating assumption that Korapay deducts the fee from the recipient /
      // transfer amount. If Korapay confirms the fee is charged separately to
      // Oneto instead, keep korapayPayoutFeeKobo as processor-expense audit
      // data and do not present it as merchant-borne until a reliable
      // fee-before-payout method exists.
      const payoutResult = await this.korapayService.initiatePayout({
        reference: korapayReference,
        amountKobo: this.toSafeNumberKobo(payoutAmountBeforeKorapayFeeKobo),
        bankCode: cashout.cashoutBankCode,
        accountNumber: cashout.cashoutAccountNumber,
        accountName: cashout.cashoutAccountName,
        narration: `Cashout ${korapayReference}`,
      });

      const korapayPayoutFeeKobo = payoutResult.payoutFeeKobo ?? cashout.korapayPayoutFeeKobo ?? null;
      await this.prisma.cashout.update({
        where: { id: cashoutId },
        data: {
          korapayResponse: this.toJsonValue(payoutResult.rawResponse),
          korapayPayoutFeeKobo,
          payoutAmountBeforeKorapayFeeKobo,
          netPayoutKobo: this.calculateNetPayoutKobo(
            grossAmountKobo,
            onetoFeeKobo,
            korapayPayoutFeeKobo,
          ),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Korapay payout initiation failed for ${cashoutId}: ${message}`);

      // Manual reversal of balance reservation since Korapay initiation failed immediately.
      // This pattern remains to ensure ledger consistency.
      await this.prisma.$transaction(
        async (tx) => {
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

          await tx.cashout.update({
            where: { id: cashoutId },
            data: { status: CashoutStatus.FAILED, failureReason: 'payout_initiation_failed' },
          });
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
      const feeFromGateway = this.korapayService.extractPayoutFeeKobo(webhookPayload.data);
      const korapayPayoutFeeKobo = feeFromGateway ?? cashout.korapayPayoutFeeKobo ?? null;
      // Atomic state transition: PROCESSING -> COMPLETED.
      // If count is 0, webhook is duplicate/out-of-order and becomes a no-op.
      await this.prisma.cashout.updateMany({
        where: { id: cashout.id, status: CashoutStatus.PROCESSING },
        data: {
          status: CashoutStatus.COMPLETED,
          completedAt: new Date(),
          korapayResponse: this.toJsonValue(webhookPayload),
          korapayPayoutFeeKobo,
          netPayoutKobo: this.calculateNetPayoutKobo(
            grossAmountKobo,
            onetoFeeKobo,
            korapayPayoutFeeKobo,
          ),
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
        netPayoutKobo: true,
        payoutAmountBeforeKorapayFeeKobo: true,
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
