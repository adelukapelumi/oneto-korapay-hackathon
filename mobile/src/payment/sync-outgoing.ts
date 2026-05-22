import { fetchOutgoingStatuses } from "../api/outgoing-status";
import { listPendingByStatus, updateTransactionStatus } from "../ledger/db";
import { logger } from "../lib/logger";

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
  markedTerminal: number;
}> {
  const pendingOutgoing = listPendingByStatus(
    "pending_reconciliation",
    "outgoing",
  );
  if (pendingOutgoing.length === 0) {
    return { markedTerminal: 0 };
  }

  try {
    let markedTerminal = 0;

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
        }
      }
    }

    return { markedTerminal };
  } catch (error: unknown) {
    logger.info("Outgoing pending sync skipped (offline or status unavailable)", error);
    return { markedTerminal: 0 };
  }
}
