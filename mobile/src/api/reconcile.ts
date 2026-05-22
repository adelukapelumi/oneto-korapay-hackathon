import { apiClient } from "./client";
import { NetworkError, toTypedError } from "./errors";
import { listPendingByStatus, updateTransactionStatus } from "../ledger/db";

export interface ReconcileResult {
  transactionId: string;
  status: "success" | "rejected";
  reason?: string;
}

export async function syncPendingEnvelopes(): Promise<{
  synced: number;
  failed: number;
  networkUnavailable?: true;
}> {
  const pending = listPendingByStatus("pending_reconciliation", "incoming");
  if (pending.length === 0) return { synced: 0, failed: 0 };

  // Batch in groups of 50 (server max).
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += 50) {
    const batch = pending.slice(i, i + 50);
    const envelopes = batch.map((tx) => JSON.parse(tx.envelopeJson));

    try {
      const res = await apiClient.post("/reconcile", { envelopes });
      const results: ReconcileResult[] = res.data;

      for (const result of results) {
        if (result.status === "success") {
          updateTransactionStatus(result.transactionId, "reconciled");
          synced++;
        } else {
          updateTransactionStatus(result.transactionId, "rejected");
          failed++;
        }
      }
    } catch (err) {
      // Network failure: leave rows pending so a later reconnect can retry.
      const typed = toTypedError(err);
      if (typed instanceof NetworkError) {
        return { synced, failed, networkUnavailable: true };
      }
      break;
    }
  }

  return { synced, failed };
}
