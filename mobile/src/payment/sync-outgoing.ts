import { fetchOutgoingStatuses } from "../api/outgoing-status";
import { NetworkError, toTypedError } from "../api/errors";
import { listPendingByStatus, updateTransactionStatus } from "../ledger/db";
import { logger } from "../lib/logger";

export interface OutgoingPendingSyncResult {
  readonly pendingBefore: number;
  readonly markedTerminal: number;
  readonly unknownPending: number;
  readonly hasNetworkError: boolean;
}

/**
 * Sync local outgoing pending transactions against backend terminal statuses.
 *
 * The backend is authoritative for whether a locally reserved outgoing payment
 * is now reconciled, expired_unclaimed, rejected, or still unknown_pending.
 *
 * Idempotent: only rows still in pending_reconciliation are considered.
 * Offline-safe: on network/schema failure, no local status changes are made.
 */
export async function syncOutgoingPendingFromServerLedger(): Promise<{
  pendingBefore: number;
  markedTerminal: number;
  unknownPending: number;
  hasNetworkError: boolean;
}> {
  const pendingOutgoing = listPendingByStatus(
    "pending_reconciliation",
    "outgoing",
  );
  if (pendingOutgoing.length === 0) {
    return {
      pendingBefore: 0,
      markedTerminal: 0,
      unknownPending: 0,
      hasNetworkError: false,
    };
  }

  try {
    let markedTerminal = 0;
    let unknownPending = 0;

    for (let i = 0; i < pendingOutgoing.length; i += 50) {
      const batch = pendingOutgoing.slice(i, i + 50);
      const transactions = batch.flatMap((tx) => {
        try {
          return [{
            transactionId: tx.id,
            signedEnvelope: JSON.parse(tx.envelopeJson),
          }];
        } catch (error: unknown) {
          logger.warn("Outgoing status sync skipped malformed local envelope", {
            transactionId: tx.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      });

      if (transactions.length === 0) {
        continue;
      }

      const statuses = await fetchOutgoingStatuses(transactions);
      for (const status of statuses) {
        if (status.status === "reconciled") {
          updateTransactionStatus(status.transactionId, "reconciled");
          markedTerminal++;
        } else if (status.status === "expired_unclaimed") {
          updateTransactionStatus(
            status.transactionId,
            "rejected",
            "expired_unclaimed",
          );
          markedTerminal++;
        } else if (status.status === "rejected") {
          updateTransactionStatus(
            status.transactionId,
            "rejected",
            status.reason,
          );
          markedTerminal++;
        } else {
          unknownPending++;
        }
      }
    }

    return {
      pendingBefore: pendingOutgoing.length,
      markedTerminal,
      unknownPending,
      hasNetworkError: false,
    };
  } catch (error: unknown) {
    const typed = toTypedError(error);
    const hasNetworkError = typed instanceof NetworkError;
    logger.info("Outgoing pending sync skipped (offline or status unavailable)", {
      pendingOutgoingCount: pendingOutgoing.length,
      hasNetworkError,
      error: typed.message,
    });
    return {
      pendingBefore: pendingOutgoing.length,
      markedTerminal: 0,
      unknownPending: 0,
      hasNetworkError,
    };
  }
}
