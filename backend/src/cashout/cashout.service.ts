import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService } from '../topup/korapay.service';
import { CashoutStatus, LedgerEntryType } from '@prisma/client';
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
    const cashout = await this.prisma.cashout.findUnique({
      where: { id: cashoutId },
    });

    if (!cashout || cashout.status !== CashoutStatus.PENDING) {
      throw new ConflictException('invalid_cashout_state');
    }

    const admin = await this.prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can approve cashouts');
    }

    const updated = await this.prisma.cashout.update({
      where: { id: cashoutId },
      data: {
        status: CashoutStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: adminUserId,
      },
    });

    // Trigger payout execution async
    this.executePayout(cashoutId).catch((err) => {
      this.logger.error(`Async payout execution failed for ${cashoutId}: ${err.message}`);
    });

    return { success: true };
  }

  private async executePayout(cashoutId: string) {
    const cashout = await this.prisma.cashout.findUnique({
      where: { id: cashoutId },
    });

    if (!cashout || cashout.status !== CashoutStatus.APPROVED) {
      return;
    }

    const korapayReference = `cashout_${crypto.randomBytes(12).toString('hex')}`;

    try {
      const success = await this.prisma.$transaction(
        async (tx) => {
          // Fix 2: Re-fetch cashout inside transaction to prevent race conditions
          const freshCashout = await tx.cashout.findUnique({
            where: { id: cashoutId },
          });

          if (!freshCashout || freshCashout.status !== CashoutStatus.APPROVED) {
            throw new Error('cashout_state_changed');
          }

          const merchant = await tx.user.findUnique({
            where: { id: cashout.merchantUserId },
          });

          if (!merchant || merchant.verifiedBalanceKobo < cashout.amountKobo) {
            await tx.cashout.update({
              where: { id: cashoutId },
              data: { status: CashoutStatus.FAILED, failureReason: 'balance_changed' },
            });
            return false;
          }

          const operatingAccount = await tx.user.findUnique({
            where: { id: this.OPERATING_USER_ID },
          });

          if (!operatingAccount) {
            throw new Error('Operating account missing');
          }

          // Update Cashout status
          await tx.cashout.update({
            where: { id: cashoutId },
            data: { status: CashoutStatus.PROCESSING, korapayReference },
          });

          // Debit merchant
          const newMerchantBalance = merchant.verifiedBalanceKobo - cashout.amountKobo;
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
          await tx.user.update({
            where: { id: merchant.id },
            data: { verifiedBalanceKobo: newMerchantBalance },
          });

          // Credit operating account
          const newOperatingBalance = operatingAccount.verifiedBalanceKobo + cashout.amountKobo;
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
          await tx.user.update({
            where: { id: operatingAccount.id },
            data: { verifiedBalanceKobo: newOperatingBalance },
          });

          return true;
        },
        { isolationLevel: 'Serializable' },
      );

      if (!success) return;

      // Outside transaction: call Korapay
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
        // ROLL BACK balance reservation via compensating entries
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
    } catch (error: any) {
      if (error.message === 'cashout_state_changed') {
        await this.prisma.cashout.update({
          where: { id: cashoutId },
          data: { status: CashoutStatus.FAILED, failureReason: 'state_changed_during_execute' },
        });
        return;
      }
      this.logger.error(`Execute payout critical failure for ${cashoutId}: ${error.message}`);
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
