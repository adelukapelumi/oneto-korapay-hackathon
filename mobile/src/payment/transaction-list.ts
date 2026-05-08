import type { LedgerEntry } from "../api/ledger";
import { listPendingTransactions } from "../ledger/db";

export type DisplayTransaction =
  | {
      source: "server";
      id: string;
      transactionId: string;
      type: "DEBIT" | "CREDIT";
      amountKobo: string;
      balanceAfterKobo: string;
      description: string;
      createdAt: string;
      status: "confirmed";
    }
  | {
      source: "local";
      id: string;
      direction: "outgoing" | "incoming";
      amountKobo: number;
      recipientLabel: string | null;
      createdAt: string;
      status: "pending_reconciliation" | "reconciled" | "rejected";
    };

/**
 * Merge server entries and local pending into a single list,
 * sorted by createdAt descending (newest first).
 *
 * Deduplication: if a local transaction's id appears in the server
 * entries' transactionId, skip the local one (server is authoritative).
 */
export function mergeTransactions(
  serverEntries: LedgerEntry[],
  localLimit: number = 50,
): DisplayTransaction[] {
  const serverTxIds = new Set(serverEntries.map((e) => e.transactionId));

  const serverDisplay: DisplayTransaction[] = serverEntries.map((e) => ({
    source: "server" as const,
    id: e.id,
    transactionId: e.transactionId,
    type: e.type,
    amountKobo: e.amountKobo,
    balanceAfterKobo: e.balanceAfterKobo,
    description: e.description,
    createdAt: e.createdAt,
    status: "confirmed" as const,
  }));

  const localPending = listPendingTransactions(localLimit, 0);
  const localDisplay: DisplayTransaction[] = localPending
    .filter((tx) => !serverTxIds.has(tx.id)) // deduplicate
    .map((tx) => ({
      source: "local" as const,
      id: tx.id,
      direction: tx.direction,
      amountKobo: tx.amountKobo,
      recipientLabel: tx.recipientLabel,
      createdAt: tx.createdAt,
      status: tx.status,
    }));

  return [...serverDisplay, ...localDisplay].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
