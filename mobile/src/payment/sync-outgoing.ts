import { fetchLedger } from "../api/ledger";
import { listPendingByStatus, updateTransactionStatus } from "../ledger/db";
import { logger } from "../lib/logger";

/**
 * Sync local outgoing pending transactions against server-confirmed ledger rows.
 *
 * If a local outgoing pending transactionId appears in /me/ledger, we mark it
 * reconciled locally so spendable balance no longer subtracts it twice.
 *
 * Idempotent: only rows still in pending_reconciliation are considered.
 * Offline-safe: on network/schema failure, no local status changes are made.
 */
export async function syncOutgoingPendingFromServerLedger(): Promise<{
  markedReconciled: number;
}> {
  const pendingOutgoing = listPendingByStatus(
    "pending_reconciliation",
    "outgoing",
  );
  if (pendingOutgoing.length === 0) {
    return { markedReconciled: 0 };
  }

  try {
    const serverTransactionIds = new Set<string>();
    let cursor: string | undefined;

    // Fetch up to 3 pages (max 300 rows) to keep sync bounded on mobile.
    for (let page = 0; page < 3; page++) {
      const response = await fetchLedger(cursor, 100);
      for (const entry of response.entries) {
        serverTransactionIds.add(entry.transactionId);
      }

      if (!response.nextCursor) {
        break;
      }
      cursor = response.nextCursor;
    }

    let markedReconciled = 0;
    for (const tx of pendingOutgoing) {
      if (serverTransactionIds.has(tx.id)) {
        updateTransactionStatus(tx.id, "reconciled");
        markedReconciled++;
      }
    }

    return { markedReconciled };
  } catch (error: unknown) {
    logger.info("Outgoing pending sync skipped (offline or ledger unavailable)", error);
    return { markedReconciled: 0 };
  }
}

