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

@Injectable()
export class CashoutService {
  private readonly logger = new Logger(CashoutService.name);
  private readonly OPERATING_USER_ID = 'u_operating';
  private readonly MIN_CASHOUT_KOBO = 1000n; // 10 NGN

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
  ) {}

  async requestCashout(merchantUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: merchantUserId },
      include: { merchantProfile: true },
    });

    if (!user || user.role !== 'MERCHANT') {
      throw new ForbiddenException('Only merchants can request cashout');
    }

    if (user.status === 'FROZEN' || user.status === 'FLAGGED') {
      throw new ForbiddenException('Account is restricted');
    }

    if (!user.merchantProfile) {
      throw new BadRequestException('merchant_profile_missing');
    }

    const amountKobo = user.verifiedBalanceKobo;
    if (amountKobo < this.MIN_CASHOUT_KOBO) {
      throw new BadRequestException('insufficient_balance_for_cashout');
    }

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
        amountKobo,
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

          // 2. Fetch merchant and check balance
          const merchant = await tx.user.findUnique({
            where: { id: cashout.merchantUserId },
          });

          if (!merchant) {
            throw new Error('merchant_not_found');
          }

          if (merchant.verifiedBalanceKobo < cashout.amountKobo) {
            throw new Error('insufficient_balance');
          }

          // 3. Fetch operating account
          const operatingAccount = await tx.user.findUnique({
            where: { id: this.OPERATING_USER_ID },
          });

          if (!operatingAccount) {
            throw new Error('operating_account_missing');
          }

          // 4. Debit merchant
          const newMerchantBalance = merchant.verifiedBalanceKobo - cashout.amountKobo;
          await tx.user.update({
            where: { id: merchant.id },
            data: { verifiedBalanceKobo: newMerchantBalance },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: korapayReference,
              userId: merchant.id,
              type: LedgerEntryType.DEBIT,
              amountKobo: cashout.amountKobo,
              balanceAfterKobo: newMerchantBalance,
              description: `Cashout payout ${korapayReference}`,
            },
          });

          // 5. Credit operating account
          const newOperatingBalance = operatingAccount.verifiedBalanceKobo + cashout.amountKobo;
          await tx.user.update({
            where: { id: operatingAccount.id },
            data: { verifiedBalanceKobo: newOperatingBalance },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: korapayReference,
              userId: operatingAccount.id,
              type: LedgerEntryType.CREDIT,
              amountKobo: cashout.amountKobo,
              balanceAfterKobo: newOperatingBalance,
              description: `Cashout payout from merchant ${merchant.id}`,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new BadRequestException('Cashout is not in PENDING status or does not exist');
      }
      if (err.message === 'insufficient_balance') {
        throw new BadRequestException('insufficient_balance_for_cashout');
      }
      if (err.message === 'operating_account_missing' || err.message === 'merchant_not_found') {
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

    try {
      await this.korapayService.initiatePayout({
        reference: korapayReference,
        amountKobo: Number(cashout.amountKobo),
        bankCode: cashout.cashoutBankCode,
        accountNumber: cashout.cashoutAccountNumber,
        accountName: cashout.cashoutAccountName,
        narration: `Cashout ${korapayReference}`,
      });
    } catch (error: any) {
      this.logger.error(`Korapay payout initiation failed for ${cashoutId}: ${error.message}`);

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
                amountKobo: cashout.amountKobo,
                balanceAfterKobo: merchant.verifiedBalanceKobo + cashout.amountKobo,
                description: `Cashout reversal ${korapayReference}`,
              },
            });
            await tx.user.update({
              where: { id: merchant.id },
              data: { verifiedBalanceKobo: { increment: cashout.amountKobo } },
            });

            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: operating.id,
                type: LedgerEntryType.DEBIT,
                amountKobo: cashout.amountKobo,
                balanceAfterKobo: operating.verifiedBalanceKobo - cashout.amountKobo,
                description: `Cashout reversal to merchant ${merchant.id}`,
              },
            });
            await tx.user.update({
              where: { id: operating.id },
              data: { verifiedBalanceKobo: { decrement: cashout.amountKobo } },
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

  async handlePayoutWebhook(payload: any, signature: string) {
    const isValid = this.korapayService.verifyWebhookSignature(payload.data, signature);
    if (!isValid) {
      throw new ForbiddenException('Invalid signature');
    }

    const reference = payload.data.reference;
    const event = payload.event;

    // Fix 3: Webhook event spoofing protection
    const eventStatusMap: Record<string, string> = {
      'transfer.success': 'success',
      'transfer.failed': 'failed',
    };
    const expectedDataStatus = eventStatusMap[event];
    if (expectedDataStatus && payload.data?.status !== expectedDataStatus) {
      this.logger.warn({ event, dataStatus: payload.data?.status }, 'Webhook event/status mismatch');
      return { success: true }; // return 200 to stop Korapay retries, but don't process
    }

    const cashout = await this.prisma.cashout.findUnique({
      where: { korapayReference: reference },
    });

    if (!cashout) {
      this.logger.warn(`Unknown korapay reference received: ${reference}`);
      return { success: true };
    }

    if (cashout.status === CashoutStatus.COMPLETED || cashout.status === CashoutStatus.FAILED) {
      return { success: true };
    }

    if (event === 'transfer.success') {
      await this.prisma.cashout.update({
        where: { id: cashout.id },
        data: { status: CashoutStatus.COMPLETED, completedAt: new Date(), korapayResponse: payload },
      });
    } else if (event === 'transfer.failed') {
      await this.prisma.$transaction(
        async (tx) => {
          const merchant = await tx.user.findUnique({ where: { id: cashout.merchantUserId } });
          const operating = await tx.user.findUnique({ where: { id: this.OPERATING_USER_ID } });

          if (merchant && operating) {
            const reverseRef = `${reference}_webhook_fail`;
            
            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: merchant.id,
                type: LedgerEntryType.CREDIT,
                amountKobo: cashout.amountKobo,
                balanceAfterKobo: merchant.verifiedBalanceKobo + cashout.amountKobo,
                description: `Cashout failure refund ${reference}`,
              },
            });
            await tx.user.update({
              where: { id: merchant.id },
              data: { verifiedBalanceKobo: { increment: cashout.amountKobo } },
            });

            await tx.ledgerEntry.create({
              data: {
                transactionId: reverseRef,
                userId: operating.id,
                type: LedgerEntryType.DEBIT,
                amountKobo: cashout.amountKobo,
                balanceAfterKobo: operating.verifiedBalanceKobo - cashout.amountKobo,
                description: `Cashout failure reversal from merchant ${merchant.id}`,
              },
            });
            await tx.user.update({
              where: { id: operating.id },
              data: { verifiedBalanceKobo: { decrement: cashout.amountKobo } },
            });
          }

          await tx.cashout.update({
            where: { id: cashout.id },
            data: {
              status: CashoutStatus.FAILED,
              failureReason: payload.data.reason || 'payout_failed_at_gateway',
              korapayResponse: payload,
            },
          });
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
