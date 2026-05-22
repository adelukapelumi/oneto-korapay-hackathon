import type { LedgerEntry } from "../api/ledger";
import { listCachedMerchants, listPendingTransactions } from "../ledger/db";

export type TransactionDisplayType = "sent" | "received" | "topup" | "cashout";
export type TransactionStatusTone = "pending" | "confirmed" | "rejected" | "released";
export type TransactionStatusIcon = "hourglass" | "check" | "x" | "released";

export interface TransactionDisplayRow {
  readonly id: string;
  readonly source: "server" | "local";
  readonly title: string;
  readonly createdAt: string;
  readonly amountKobo: number;
  readonly amountDirection: "debit" | "credit";
  readonly displayType: TransactionDisplayType;
  readonly statusLabel: string;
  readonly statusTone: TransactionStatusTone;
  readonly statusIcon: TransactionStatusIcon;
}

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
      terminalReason: string | null;
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
      terminalReason: tx.terminalReason,
    }));

  return [...serverDisplay, ...localDisplay].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getCachedMerchantLabelsByUserId(): ReadonlyMap<string, string> {
  return new Map(
    listCachedMerchants().map((merchant) => [merchant.userId, merchant.label]),
  );
}

export function buildTransactionDisplayRows(
  serverEntries: LedgerEntry[],
  options: {
    readonly localLimit?: number;
    readonly limit?: number;
    readonly merchantLabelsByUserId?: ReadonlyMap<string, string>;
  } = {},
): TransactionDisplayRow[] {
  const merged = mergeTransactions(serverEntries, options.localLimit ?? 50);
  const merchantLabelsByUserId =
    options.merchantLabelsByUserId ?? getCachedMerchantLabelsByUserId();
  const rows = merged.map((tx) =>
    toTransactionDisplayRow(tx, merchantLabelsByUserId),
  );

  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

export function toTransactionDisplayRow(
  tx: DisplayTransaction,
  merchantLabelsByUserId: ReadonlyMap<string, string> = new Map(),
): TransactionDisplayRow {
  if (tx.source === "server") {
    return serverEntryToDisplayRow(tx, merchantLabelsByUserId);
  }

  return localEntryToDisplayRow(tx);
}

function serverEntryToDisplayRow(
  tx: Extract<DisplayTransaction, { source: "server" }>,
  merchantLabelsByUserId: ReadonlyMap<string, string>,
): TransactionDisplayRow {
  const isDebit = tx.type === "DEBIT";
  const description = tx.description ?? "";
  const title = sanitizeServerDescription(
    description,
    isDebit,
    merchantLabelsByUserId,
  );
  const displayType = getServerDisplayType(description, isDebit);

  return {
    id: tx.id,
    source: "server",
    title,
    createdAt: tx.createdAt,
    amountKobo: Number(tx.amountKobo),
    amountDirection: isDebit ? "debit" : "credit",
    displayType,
    statusLabel: "Confirmed",
    statusTone: "confirmed",
    statusIcon: "check",
  };
}

function localEntryToDisplayRow(
  tx: Extract<DisplayTransaction, { source: "local" }>,
): TransactionDisplayRow {
  const isExpiredRelease =
    tx.direction === "outgoing" && tx.terminalReason === "expired_unclaimed";
  const isIncoming = tx.direction === "incoming";
  const counterpartyLabel = normalizeCounterpartyLabel(tx.recipientLabel);

  if (isExpiredRelease) {
    return {
      id: tx.id,
      source: "local",
      title: "Payment expired unclaimed",
      createdAt: tx.createdAt,
      amountKobo: tx.amountKobo,
      amountDirection: "credit",
      displayType: "received",
      statusLabel: "Released",
      statusTone: "released",
      statusIcon: "released",
    };
  }

  if (tx.status === "rejected") {
    return {
      id: tx.id,
      source: "local",
      title: isIncoming
        ? `Payment from ${counterpartyLabel ?? "student"}`
        : `Payment to ${counterpartyLabel ?? "merchant"}`,
      createdAt: tx.createdAt,
      amountKobo: tx.amountKobo,
      amountDirection: isIncoming ? "credit" : "debit",
      displayType: isIncoming ? "received" : "sent",
      statusLabel: "Rejected",
      statusTone: "rejected",
      statusIcon: "x",
    };
  }

  const isConfirmedLocal = tx.status === "reconciled";

  return {
    id: tx.id,
    source: "local",
    title: isIncoming
      ? `Payment from ${counterpartyLabel ?? "student"}`
      : `Payment to ${counterpartyLabel ?? "merchant"}`,
    createdAt: tx.createdAt,
    amountKobo: tx.amountKobo,
    amountDirection: isIncoming ? "credit" : "debit",
    displayType: isIncoming ? "received" : "sent",
    statusLabel: isConfirmedLocal
      ? "Confirmed"
      : isIncoming
        ? "Pending verification"
        : "Pending",
    statusTone: isConfirmedLocal ? "confirmed" : "pending",
    statusIcon: isConfirmedLocal ? "check" : "hourglass",
  };
}

function getServerDisplayType(
  description: string,
  isDebit: boolean,
): TransactionDisplayType {
  if (
    description.startsWith("Top-up") ||
    description.startsWith("TOPUP") ||
    description.includes("Korapay")
  ) {
    return "topup";
  }

  if (description.startsWith("Cashout") || description.includes("cashout")) {
    return "cashout";
  }

  return isDebit ? "sent" : "received";
}

function sanitizeServerDescription(
  description: string,
  isDebit: boolean,
  merchantLabelsByUserId: ReadonlyMap<string, string>,
): string {
  if (
    description.startsWith("Top-up") ||
    description.startsWith("TOPUP") ||
    description.includes("Korapay")
  ) {
    return "Top-up via Korapay";
  }

  if (description.startsWith("Cashout") || description.includes("cashout")) {
    return "Cashout";
  }

  const paymentTo = description.match(/^Payment to (.+)$/);
  if (paymentTo) {
    const rawCounterparty = paymentTo[1]?.trim() ?? "";
    const merchantLabel = merchantLabelsByUserId.get(rawCounterparty);
    if (merchantLabel) {
      return `Payment to ${merchantLabel}`;
    }
    return isRawUserId(rawCounterparty) ? "Payment to merchant" : description;
  }

  const paymentFrom = description.match(/^Payment from (.+)$/);
  if (paymentFrom) {
    const rawCounterparty = paymentFrom[1]?.trim() ?? "";
    const merchantLabel = merchantLabelsByUserId.get(rawCounterparty);
    if (merchantLabel) {
      return `Payment from ${merchantLabel}`;
    }
    return isRawUserId(rawCounterparty) ? "Payment from student" : description;
  }

  if (isRawUserId(description)) {
    return isDebit ? "Payment to merchant" : "Payment from student";
  }

  return description || (isDebit ? "Payment to merchant" : "Payment from student");
}

function normalizeCounterpartyLabel(label: string | null): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed || isRawUserId(trimmed)) return null;
  return trimmed;
}

function isRawUserId(value: string): boolean {
  return /^u_[A-Za-z0-9_-]+$/.test(value);
}
