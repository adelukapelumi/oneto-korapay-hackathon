import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TransactionEnvelope,
  TransactionEnvelopeSchema,
  verifyEnvelope,
  MAX_OFFLINE_TRANSACTION_KOBO,
  MAX_USER_BALANCE_KOBO,
  toPublicKeyString,
  OFFLINE_CLAIM_WINDOW_HOURS,
} from '@oneto/shared';
import {
  DeviceKeyStatus,
  OfflinePaymentResolutionStatus,
  Prisma,
} from '@prisma/client';

export type ReconcileResult =
  | { transactionId: string; status: 'success' }
  | { transactionId: string; status: 'rejected'; reason: string };

export interface OutgoingStatusRequestItem {
  readonly transactionId: string;
  readonly signedEnvelope?: unknown;
}

export type OutgoingPaymentStatus =
  | 'reconciled'
  | 'rejected'
  | 'expired_unclaimed'
  | 'unknown_pending';

export interface OutgoingStatusResult {
  readonly transactionId: string;
  readonly status: OutgoingPaymentStatus;
  readonly reason?: string;
  readonly claimDeadlineAt?: string;
}

const OFFLINE_CLAIM_WINDOW_MS = OFFLINE_CLAIM_WINDOW_HOURS * 60 * 60 * 1000;

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static readonly LEDGER_IDEMPOTENCY_TARGET_KEYS = ['transactionid', 'userid'];
  private static readonly PROCESSED_SEQUENCE_TARGET_KEYS = ['userid', 'sequencenumber'];

  async reconcile(
    authenticatedUserId: string,
    envelopes: unknown[],
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

  async resolveOutgoingStatuses(
    authenticatedUserId: string,
    transactions: readonly OutgoingStatusRequestItem[],
  ): Promise<OutgoingStatusResult[]> {
    const results: OutgoingStatusResult[] = [];

    for (const transaction of transactions) {
      results.push(
        await this.resolveOutgoingStatus(authenticatedUserId, transaction),
      );
    }

    return results;
  }

  /**
   * Internal reconciliation logic that returns detailed rejection reasons.
   * Exposed for testing only. Clients should use the public reconcile() method.
   */
  async reconcileOneInternal(
    authenticatedUserId: string,
    envelopeInput: unknown,
  ): Promise<ReconcileResult> {
    // Best-effort transactionId for logs/responses when the input is malformed
    // and zod parsing has not yet run.
    const transactionId = this.extractTransactionId(envelopeInput);

    // Snapshot of the parsed envelope, captured for the outer catch block so
    // it can include validated context in error responses without re-parsing.
    let validatedEnvelope: TransactionEnvelope | undefined;

    try {
      // a. Envelope shape validation via the zod schema from /shared.
      const parseResult = TransactionEnvelopeSchema.safeParse(envelopeInput);
      if (!parseResult.success) {
        return this.reject(transactionId, 'schema_invalid');
      }
      const envelope = parseResult.data;
      validatedEnvelope = envelope;

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

      const nowMs = Date.now();

      const senderDeviceKey = await this.prisma.userDeviceKey.findUnique({
        where: {
          userId_publicKey: {
            userId: envelope.senderUserId,
            publicKey: envelope.senderPublicKey,
          },
        },
        select: {
          publicKey: true,
          status: true,
          retiredAt: true,
          verifyUntil: true,
        },
      });

      if (!senderDeviceKey) {
        return this.reject(envelope.transactionId, 'public_key_unknown', envelope);
      }

      const deviceKeyRejectionReason = this.getDeviceKeyRejectionReason(
        senderDeviceKey,
        envelope,
        nowMs,
      );
      if (deviceKeyRejectionReason) {
        return this.reject(envelope.transactionId, deviceKeyRejectionReason, envelope);
      }

      // e & f & g & h & i: Use shared verifyEnvelope for consistency.
      // Reconcile ignores the short QR display freshness window because the
      // settlement deadline is a separate backend claim window.
      // senderDeviceKey.publicKey was either created via the validated key
      // registration endpoint or backfilled from that same mirror field.
      const verification = verifyEnvelope(
        envelope,
        toPublicKeyString(senderDeviceKey.publicKey),
        nowMs,
        { allowExpiredEnvelope: true },
      );


      if (!verification.ok) {
        let reason = 'envelope_rejected';
        switch (verification.reason) {
          case 'timestamp_out_of_window':
            reason = 'timestamp_out_of_window';
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

      const existingResolution = await this.prisma.offlinePaymentResolution.findUnique({
        where: { transactionId: envelope.transactionId },
        select: {
          senderUserId: true,
          status: true,
        },
      });
      if (existingResolution && existingResolution.senderUserId === envelope.senderUserId) {
        if (existingResolution.status === OfflinePaymentResolutionStatus.EXPIRED_UNCLAIMED) {
          return this.reject(envelope.transactionId, 'late_claim_rejected', envelope);
        }

        return this.reject(envelope.transactionId, 'terminal_rejection_recorded', envelope);
      }

      const claimDeadlineMs = this.getClaimDeadlineMs(envelope.timestamp);
      if (nowMs > claimDeadlineMs) {
        const expiredOutcome = await this.recordExpiredUnclaimedIfStillPending(envelope);
        if (expiredOutcome.status === 'reconciled') {
          return { transactionId: envelope.transactionId, status: 'success' };
        }

        return this.reject(envelope.transactionId, 'late_claim_rejected', envelope);
      }

      // j. Check server balance.
      if (sender.verifiedBalanceKobo < BigInt(envelope.amountKobo)) {
        return this.reject(envelope.transactionId, 'insufficient_balance', envelope);
      }

      // k. Check sender user status.
      if (sender.status === 'FROZEN' || sender.status === 'FLAGGED') {
        return this.reject(envelope.transactionId, 'account_frozen', envelope);
      }

      let retries = 0;
      const maxRetries = 3;

      while (true) {
        try {
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
                  envelopeJson: envelope as unknown as Prisma.InputJsonValue,
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

              if (recipient.verifiedBalanceKobo + BigInt(envelope.amountKobo) > BigInt(MAX_USER_BALANCE_KOBO)) {
                throw new Error('recipient_balance_cap_exceeded');
              }

              await tx.ledgerEntry.create({
                data: {
                  transactionId: envelope.transactionId,
                  userId: envelope.recipientUserId,
                  type: 'CREDIT',
                  amountKobo: BigInt(envelope.amountKobo),
                  balanceAfterKobo: recipient.verifiedBalanceKobo + BigInt(envelope.amountKobo),
                  description: `Payment from ${envelope.senderUserId}`,
                  envelopeJson: envelope as unknown as Prisma.InputJsonValue,
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
                return this.resolveReconcileUniqueConflict(tx, envelope, error);
              }
              throw error;
            }
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            retries++;
            if (retries >= maxRetries) {
              this.logger.error(`Reconciliation failed after ${maxRetries} serialization retries for ${envelope.transactionId}`);
              throw error;
            }
            this.logger.warn(`Serialization anomaly (P2034) for ${envelope.transactionId}. Retrying ${retries}/${maxRetries}...`);
            await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, retries)));
            continue;
          }
          throw error;
        }
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const txId = validatedEnvelope?.transactionId ?? transactionId;
      if (message === 'balance_changed_during_reconcile') {
        return this.reject(txId, 'insufficient_balance', validatedEnvelope);
      }
      if (message === 'recipient_balance_cap_exceeded') {
        return this.reject(txId, 'recipient_balance_cap_exceeded', validatedEnvelope);
      }
      
      // If it's a P2034 after max retries, throw so the whole batch is retried later
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new InternalServerErrorException('Database serialization error, please retry');
      }

      this.logger.error(`Internal error reconciling envelope ${txId}:`, error);
      return {
        transactionId: txId,
        status: 'rejected',
        reason: 'internal_error',
      };
    }
  }

  private async resolveOutgoingStatus(
    authenticatedUserId: string,
    transaction: OutgoingStatusRequestItem,
  ): Promise<OutgoingStatusResult> {
    if (await this.hasSettledDebitForSender(this.prisma, authenticatedUserId, transaction.transactionId)) {
      return {
        transactionId: transaction.transactionId,
        status: 'reconciled',
      };
    }

    const existingResolution = await this.prisma.offlinePaymentResolution.findUnique({
      where: { transactionId: transaction.transactionId },
      select: {
        transactionId: true,
        senderUserId: true,
        status: true,
        reason: true,
        claimDeadlineAt: true,
      },
    });
    if (existingResolution && existingResolution.senderUserId === authenticatedUserId) {
      return this.mapResolutionToOutgoingStatus(existingResolution);
    }

    const parseResult = TransactionEnvelopeSchema.safeParse(transaction.signedEnvelope);
    if (!parseResult.success) {
      return this.buildRejectedOutgoingStatus(
        transaction.transactionId,
        'invalid_envelope',
      );
    }

    const envelope = parseResult.data;
    if (envelope.transactionId !== transaction.transactionId) {
      return this.buildRejectedOutgoingStatus(
        transaction.transactionId,
        'transaction_id_mismatch',
      );
    }

    if (envelope.senderUserId !== authenticatedUserId) {
      return this.buildRejectedOutgoingStatus(
        transaction.transactionId,
        'identity_mismatch',
      );
    }

    const nowMs = Date.now();
    const senderDeviceKey = await this.prisma.userDeviceKey.findUnique({
      where: {
        userId_publicKey: {
          userId: envelope.senderUserId,
          publicKey: envelope.senderPublicKey,
        },
      },
      select: {
        publicKey: true,
        status: true,
        retiredAt: true,
        verifyUntil: true,
      },
    });
    if (!senderDeviceKey) {
      return this.buildRejectedOutgoingStatus(
        envelope.transactionId,
        'public_key_unknown',
        this.getClaimDeadlineIso(envelope.timestamp),
      );
    }

    const deviceKeyRejectionReason = this.getDeviceKeyRejectionReason(
      senderDeviceKey,
      envelope,
      nowMs,
    );
    if (deviceKeyRejectionReason) {
      return this.buildRejectedOutgoingStatus(
        envelope.transactionId,
        deviceKeyRejectionReason,
        this.getClaimDeadlineIso(envelope.timestamp),
      );
    }

    const verification = verifyEnvelope(
      envelope,
      toPublicKeyString(senderDeviceKey.publicKey),
      nowMs,
      { allowExpiredEnvelope: true },
    );
    if (!verification.ok) {
      return this.buildRejectedOutgoingStatus(
        envelope.transactionId,
        verification.reason,
        this.getClaimDeadlineIso(envelope.timestamp),
      );
    }

    const claimDeadlineIso = this.getClaimDeadlineIso(envelope.timestamp);
    if (nowMs <= this.getClaimDeadlineMs(envelope.timestamp)) {
      return {
        transactionId: envelope.transactionId,
        status: 'unknown_pending',
        claimDeadlineAt: claimDeadlineIso,
      };
    }

    return this.recordExpiredUnclaimedIfStillPending(envelope);
  }

  private reject(
    transactionId: string,
    internalReason: string,
    envelope?: TransactionEnvelope,
  ): ReconcileResult {
    this.logger.warn({
      transactionId,
      senderUserId: envelope?.senderUserId,
      recipientUserId: envelope?.recipientUserId,
      reason: internalReason,
      amountKobo: envelope?.amountKobo,
    }, 'Envelope rejected');

    return {
      transactionId,
      status: 'rejected',
      reason: internalReason,
    };
  }

  private extractTransactionId(input: unknown): string {
    if (
      typeof input === 'object' &&
      input !== null &&
      'transactionId' in input
    ) {
      const tx = (input as { transactionId: unknown }).transactionId;
      if (typeof tx === 'string') return tx;
    }
    return 'unknown';
  }

  private getDeviceKeyRejectionReason(
    deviceKey: {
      publicKey: string;
      status: DeviceKeyStatus;
      retiredAt: Date | null;
      verifyUntil: Date | null;
    },
    envelope: TransactionEnvelope,
    nowMs: number,
  ): string | null {
    if (deviceKey.status === DeviceKeyStatus.ACTIVE) {
      return null;
    }

    if (deviceKey.status === DeviceKeyStatus.REVOKED) {
      return 'public_key_revoked';
    }

    if (deviceKey.retiredAt === null) {
      return 'verify_only_missing_retired_at';
    }

    const envelopeTimestampMs = new Date(envelope.timestamp).getTime();
    if (envelopeTimestampMs > deviceKey.retiredAt.getTime()) {
      return 'verify_only_envelope_after_retired_at';
    }

    if (deviceKey.verifyUntil !== null && nowMs > deviceKey.verifyUntil.getTime()) {
      return 'verify_only_window_expired';
    }

    return null;
  }

  private getClaimDeadlineMs(timestamp: string): number {
    return new Date(timestamp).getTime() + OFFLINE_CLAIM_WINDOW_MS;
  }

  private getClaimDeadlineIso(timestamp: string): string {
    return new Date(this.getClaimDeadlineMs(timestamp)).toISOString();
  }

  private buildRejectedOutgoingStatus(
    transactionId: string,
    reason: string,
    claimDeadlineAt?: string,
  ): OutgoingStatusResult {
    return {
      transactionId,
      status: 'rejected',
      reason,
      claimDeadlineAt,
    };
  }

  private mapResolutionToOutgoingStatus(
    resolution: {
      transactionId: string;
      status: OfflinePaymentResolutionStatus;
      reason: string;
      claimDeadlineAt: Date;
    },
  ): OutgoingStatusResult {
    if (resolution.status === OfflinePaymentResolutionStatus.EXPIRED_UNCLAIMED) {
      return {
        transactionId: resolution.transactionId,
        status: 'expired_unclaimed',
        reason: resolution.reason,
        claimDeadlineAt: resolution.claimDeadlineAt.toISOString(),
      };
    }

    return {
      transactionId: resolution.transactionId,
      status: 'rejected',
      reason: resolution.reason,
      claimDeadlineAt: resolution.claimDeadlineAt.toISOString(),
    };
  }

  private async hasSettledDebitForSender(
    client: PrismaService | Prisma.TransactionClient,
    senderUserId: string,
    transactionId: string,
  ): Promise<boolean> {
    const existingDebit = await client.ledgerEntry.findFirst({
      where: {
        transactionId,
        userId: senderUserId,
        type: 'DEBIT',
      },
      select: { id: true },
    });

    return existingDebit !== null;
  }

  private async recordExpiredUnclaimedIfStillPending(
    envelope: TransactionEnvelope,
  ): Promise<OutgoingStatusResult> {
    return this.prisma.$transaction(async (tx) => {
      const settledReplay = await this.hasMatchingLedgerEntriesForReplay(tx, envelope);
      if (settledReplay) {
        return {
          transactionId: envelope.transactionId,
          status: 'reconciled',
        };
      }

      const existingResolution = await tx.offlinePaymentResolution.findUnique({
        where: { transactionId: envelope.transactionId },
        select: {
          transactionId: true,
          senderUserId: true,
          status: true,
          reason: true,
          claimDeadlineAt: true,
        },
      });
      if (existingResolution && existingResolution.senderUserId === envelope.senderUserId) {
        return this.mapResolutionToOutgoingStatus(existingResolution);
      }

      try {
        const createdResolution = await tx.offlinePaymentResolution.create({
          data: {
            transactionId: envelope.transactionId,
            senderUserId: envelope.senderUserId,
            recipientUserId: envelope.recipientUserId,
            status: OfflinePaymentResolutionStatus.EXPIRED_UNCLAIMED,
            reason: 'claim_window_elapsed',
            claimDeadlineAt: new Date(this.getClaimDeadlineMs(envelope.timestamp)),
            envelopeJson: envelope as unknown as Prisma.InputJsonValue,
          },
          select: {
            transactionId: true,
            status: true,
            reason: true,
            claimDeadlineAt: true,
          },
        });

        return this.mapResolutionToOutgoingStatus(createdResolution);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const concurrentResolution = await tx.offlinePaymentResolution.findUnique({
            where: { transactionId: envelope.transactionId },
            select: {
              transactionId: true,
              senderUserId: true,
              status: true,
              reason: true,
              claimDeadlineAt: true,
            },
          });
          if (concurrentResolution && concurrentResolution.senderUserId === envelope.senderUserId) {
            return this.mapResolutionToOutgoingStatus(concurrentResolution);
          }
        }

        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async resolveReconcileUniqueConflict(
    tx: Prisma.TransactionClient,
    envelope: TransactionEnvelope,
    error: Prisma.PrismaClientKnownRequestError,
  ): Promise<ReconcileResult> {
    const uniqueTarget = this.extractUniqueTargetColumns(error);
    const isProcessedSequenceViolation =
      this.targetIncludesAll(uniqueTarget, ReconcileService.PROCESSED_SEQUENCE_TARGET_KEYS);
    const isLedgerIdempotencyViolation =
      this.targetIncludesAll(uniqueTarget, ReconcileService.LEDGER_IDEMPOTENCY_TARGET_KEYS);

    if (isProcessedSequenceViolation) {
      const existingSequence = await tx.processedSequence.findUnique({
        where: {
          userId_sequenceNumber: {
            userId: envelope.senderUserId,
            sequenceNumber: envelope.senderSequenceNumber,
          },
        },
        select: { transactionId: true },
      });

      if (!existingSequence) {
        return this.reject(envelope.transactionId, 'sequence_collision', envelope);
      }

      if (existingSequence.transactionId !== envelope.transactionId) {
        return this.reject(envelope.transactionId, 'sequence_collision', envelope);
      }

      const isExistingLedgerEquivalent = await this.hasMatchingLedgerEntriesForReplay(tx, envelope);
      if (!isExistingLedgerEquivalent) {
        return this.reject(envelope.transactionId, 'idempotency_conflict', envelope);
      }

      this.logger.log(
        `Idempotent replay accepted for transaction ${envelope.transactionId} (processed-sequence uniqueness)`,
      );
      return { transactionId: envelope.transactionId, status: 'success' };
    }

    if (isLedgerIdempotencyViolation) {
      const isExistingLedgerEquivalent = await this.hasMatchingLedgerEntriesForReplay(tx, envelope);
      if (!isExistingLedgerEquivalent) {
        return this.reject(envelope.transactionId, 'idempotency_conflict', envelope);
      }

      this.logger.log(
        `Idempotent replay accepted for transaction ${envelope.transactionId} (ledger uniqueness)`,
      );
      return { transactionId: envelope.transactionId, status: 'success' };
    }

    this.logger.error(
      `Fail-closed on ambiguous unique violation during reconcile ${envelope.transactionId}`,
      { prismaTarget: (error.meta as { target?: unknown } | undefined)?.target },
    );
    return this.reject(envelope.transactionId, 'internal_error', envelope);
  }

  private extractUniqueTargetColumns(error: Prisma.PrismaClientKnownRequestError): string[] {
    const meta = error.meta as { target?: unknown } | undefined;
    const target = meta?.target;

    if (Array.isArray(target)) {
      return target
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.toLowerCase());
    }

    if (typeof target === 'string') {
      return [target.toLowerCase()];
    }

    return [];
  }

  private targetIncludesAll(targetColumns: string[], expectedColumns: readonly string[]): boolean {
    return expectedColumns.every((column) => targetColumns.some((target) => target.includes(column)));
  }

  private async hasMatchingLedgerEntriesForReplay(
    tx: Prisma.TransactionClient,
    envelope: TransactionEnvelope,
  ): Promise<boolean> {
    const existingRows = await tx.ledgerEntry.findMany({
      where: {
        transactionId: envelope.transactionId,
      },
      select: {
        userId: true,
        type: true,
        amountKobo: true,
        envelopeJson: true,
      },
    });

    const expectedAmountKobo = BigInt(envelope.amountKobo);
    const senderRow = existingRows.find(
      (row) =>
        row.userId === envelope.senderUserId &&
        row.type === 'DEBIT' &&
        row.amountKobo === expectedAmountKobo,
    );
    const recipientRow = existingRows.find(
      (row) =>
        row.userId === envelope.recipientUserId &&
        row.type === 'CREDIT' &&
        row.amountKobo === expectedAmountKobo,
    );

    if (!senderRow || !recipientRow) {
      return false;
    }

    return (
      this.envelopeJsonMatchesReplay(senderRow.envelopeJson, envelope) &&
      this.envelopeJsonMatchesReplay(recipientRow.envelopeJson, envelope)
    );
  }

  private envelopeJsonMatchesReplay(
    storedEnvelopeJson: Prisma.JsonValue | null,
    envelope: TransactionEnvelope,
  ): boolean {
    if (!storedEnvelopeJson || typeof storedEnvelopeJson !== 'object' || Array.isArray(storedEnvelopeJson)) {
      return false;
    }

    const value = storedEnvelopeJson as Record<string, unknown>;
    return (
      value.transactionId === envelope.transactionId &&
      value.senderUserId === envelope.senderUserId &&
      value.recipientUserId === envelope.recipientUserId &&
      value.senderSequenceNumber === envelope.senderSequenceNumber &&
      value.amountKobo === envelope.amountKobo
    );
  }
}
