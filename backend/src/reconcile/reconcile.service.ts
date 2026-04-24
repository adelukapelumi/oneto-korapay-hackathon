import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TransactionEnvelope,
  TransactionEnvelopeSchema,
  verifyEnvelope,
  MAX_OFFLINE_TRANSACTION_KOBO,
} from '@oneto/shared';
import { Prisma } from '@prisma/client';

export type ReconcileResult =
  | { transactionId: string; status: 'success' }
  | { transactionId: string; status: 'rejected'; reason: string };

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcile(
    authenticatedUserId: string,
    envelopes: any[],
  ): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = [];

    for (const envelopeInput of envelopes) {
      const internalResult = await this.reconcileOneInternal(authenticatedUserId, envelopeInput);
      
      if (internalResult.status === 'rejected') {
        results.push({
          transactionId: internalResult.transactionId,
          status: 'rejected',
          reason: 'invalid_envelope',
        });
      } else {
        results.push(internalResult);
      }
    }

    return results;
  }

  /**
   * Internal reconciliation logic that returns detailed rejection reasons.
   * Exposed for testing only. Clients should use the public reconcile() method.
   */
  async reconcileOneInternal(
    authenticatedUserId: string,
    envelopeInput: any,
  ): Promise<ReconcileResult> {
    const transactionId = envelopeInput?.transactionId || 'unknown';

    try {
      // a. Envelope shape validation via the zod schema from /shared.
      const parseResult = TransactionEnvelopeSchema.safeParse(envelopeInput);
      if (!parseResult.success) {
        return this.reject(transactionId, 'schema_invalid', envelopeInput);
      }
      const envelope = parseResult.data;

      // b. envelope.recipientUserId === authenticatedUserId.
      if (envelope.recipientUserId !== authenticatedUserId) {
        return this.reject(envelope.transactionId, 'identity_mismatch', envelope);
      }

      // NEW: MERCHANT role enforcement.
      // Recipient must be a merchant to receive funds in the closed-loop system.
      const recipient = await this.prisma.user.findUnique({
        where: { id: authenticatedUserId },
        select: { role: true },
      });

      if (!recipient || recipient.role !== 'MERCHANT') {
        return this.reject(envelope.transactionId, 'recipient_not_merchant', envelope);
      }

      // c. Look up sender via Prisma.
      const sender = await this.prisma.user.findUnique({
        where: { id: envelope.senderUserId },
      });
      if (!sender) {
        return this.reject(envelope.transactionId, 'sender_unknown', envelope);
      }

      // d. Check sender.publicKey === envelope.senderPublicKey.
      if (sender.publicKey !== envelope.senderPublicKey) {
        return this.reject(envelope.transactionId, 'public_key_mismatch', envelope);
      }

      // e. Check timestamp: Math.abs(nowMs - Date.parse(envelope.timestamp)) <= 120_000.
      const nowMs = Date.now();
      const timestampMs = new Date(envelope.timestamp).getTime();
      if (Math.abs(nowMs - timestampMs) > 120_000) {
        return this.reject(envelope.transactionId, 'timestamp_out_of_window', envelope);
      }

      // f & g & h & i: Use shared verifyEnvelope for consistency
      // But we need to map them back to the specific reasons required.
      const verification = verifyEnvelope(envelope, sender.publicKey as any, nowMs);


      if (!verification.ok) {
        let reason = 'envelope_rejected';
        switch (verification.reason) {
          case 'timestamp_out_of_window':
            // Check if it's expired vs future skew
            const exp = new Date(envelope.expiresAt).getTime();
            reason = exp <= nowMs ? 'envelope_expired' : 'timestamp_out_of_window';
            break;
          case 'schema_invalid':
            // shared's schema check covers amount and math
            if (envelope.amountKobo <= 0 || envelope.amountKobo > MAX_OFFLINE_TRANSACTION_KOBO) {
              reason = 'amount_out_of_range';
            } else if (envelope.senderBalanceAfterKobo !== envelope.senderBalanceBeforeKobo - envelope.amountKobo) {
              reason = 'balance_math_inconsistent';
            } else {
              reason = 'schema_invalid';
            }
            break;
          case 'signature_invalid':
            reason = 'signature_invalid';
            break;
          case 'public_key_mismatch':
            reason = 'public_key_mismatch';
            break;
          default:
            reason = 'envelope_rejected';
        }

        return this.reject(envelope.transactionId, reason, envelope);
      }

      // j. Check server balance.
      if (sender.verifiedBalanceKobo < BigInt(envelope.amountKobo)) {
        return this.reject(envelope.transactionId, 'insufficient_balance', envelope);
      }

      // k. Check sender user status.
      if (sender.status === 'FROZEN' || sender.status === 'FLAGGED') {
        return this.reject(envelope.transactionId, 'account_frozen', envelope);
      }

      // If all checks pass, execute a Serializable Prisma transaction.
      return await this.prisma.$transaction(async (tx) => {
        try {
          // Fix 1: Re-fetch sender inside transaction to prevent race conditions
          const freshSender = await tx.user.findUnique({
            where: { id: envelope.senderUserId },
            select: { verifiedBalanceKobo: true, status: true },
          });

          if (!freshSender || freshSender.verifiedBalanceKobo < BigInt(envelope.amountKobo)) {
            throw new Error('balance_changed_during_reconcile');
          }

          if (freshSender.status === 'FROZEN' || freshSender.status === 'FLAGGED') {
            throw new Error('balance_changed_during_reconcile'); // Re-use for consistent rejection
          }

          // 1. Insert ProcessedSequence row.
          await tx.processedSequence.create({
            data: {
              userId: envelope.senderUserId,
              sequenceNumber: envelope.senderSequenceNumber,
              transactionId: envelope.transactionId,
            },
          });

          // 2. Insert LedgerEntry DEBIT row for sender.
          await tx.ledgerEntry.create({
            data: {
              transactionId: envelope.transactionId,
              userId: envelope.senderUserId,
              type: 'DEBIT',
              amountKobo: BigInt(envelope.amountKobo),
              balanceAfterKobo: freshSender.verifiedBalanceKobo - BigInt(envelope.amountKobo),
              description: `Payment to ${envelope.recipientUserId}`,
              envelopeJson: envelope as any,
            },
          });

          // 3. Insert LedgerEntry CREDIT row for recipient.
          // Need recipient's current balance for the LedgerEntry.
          const recipient = await tx.user.findUnique({
            where: { id: envelope.recipientUserId },
            select: { verifiedBalanceKobo: true },
          });

          if (!recipient) {
            throw new Error(`Recipient ${envelope.recipientUserId} not found during transaction`);
          }

          await tx.ledgerEntry.create({
            data: {
              transactionId: envelope.transactionId,
              userId: envelope.recipientUserId,
              type: 'CREDIT',
              amountKobo: BigInt(envelope.amountKobo),
              balanceAfterKobo: recipient.verifiedBalanceKobo + BigInt(envelope.amountKobo),
              description: `Payment from ${envelope.senderUserId}`,
              envelopeJson: envelope as any,
            },
          });

          // 4. Update sender balance.
          await tx.user.update({
            where: { id: envelope.senderUserId },
            data: { verifiedBalanceKobo: { decrement: BigInt(envelope.amountKobo) } },
          });

          // 5. Update recipient balance.
          await tx.user.update({
            where: { id: envelope.recipientUserId },
            data: { verifiedBalanceKobo: { increment: BigInt(envelope.amountKobo) } },
          });

          return { transactionId: envelope.transactionId, status: 'success' as const };
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            this.logger.log(`Idempotent success for transaction ${envelope.transactionId} (P2002)`);
            return { transactionId: envelope.transactionId, status: 'success' as const };
          }
          throw error;
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    } catch (error: any) {
      if (error.message === 'balance_changed_during_reconcile') {
        return this.reject(envelopeInput?.transactionId || 'unknown', 'insufficient_balance', envelopeInput);
      }
      this.logger.error(`Internal error reconciling envelope ${transactionId}:`, error);
      return {
        transactionId,
        status: 'rejected',
        reason: 'internal_error',
      };
    }
  }

  private reject(transactionId: string, internalReason: string, envelope?: any): ReconcileResult {
    this.logger.warn({
      transactionId,
      senderUserId: envelope?.senderUserId,
      recipientUserId: envelope?.recipientUserId,
      internalReason,
    }, 'Envelope rejected');

    return {
      transactionId,
      status: 'rejected',
      reason: internalReason,
    };
  }
}
