// Local SQLite ledger — the device's persistent store for signed envelopes.
//
// Uses expo-sqlite v16 synchronous API (openDatabaseSync / runSync /
// getFirstSync / getAllSync). Synchronous queries are fine for our scale:
// pilot payments are rare events and we never do heavy batch operations on
// the JS thread here.
//
// All money values stored as INTEGER (kobo, never float).
// All timestamps stored as TEXT ISO 8601 UTC strings.
//
// This module is a singleton: one database handle shared for the app's
// lifetime. Call initDb() once at app boot (from AuthProvider) before
// any other function in this module.

import * as SQLite from "expo-sqlite";

// ----------------------------------------------------------------
// Internal singleton
// ----------------------------------------------------------------

let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (db === null) {
    throw new Error(
      "SQLite ledger not initialised. Call initDb() at app boot before using the ledger.",
    );
  }
  return db;
}

// ----------------------------------------------------------------
// Public types
// ----------------------------------------------------------------

export interface PendingTransaction {
  readonly id: string; // transactionId (tx_ + 16 hex)
  readonly envelopeJson: string; // full signed TransactionEnvelope JSON
  readonly recipientId: string;
  readonly recipientLabel: string | null;
  readonly amountKobo: number; // INTEGER kobo — never float
  readonly sequenceNumber: number;
  readonly direction: "outgoing" | "incoming";
  readonly status:
    | "pending_reconciliation"
    | "reconciled"
    | "rejected";
  readonly createdAt: string; // ISO 8601 UTC
  readonly reconciledAt: string | null; // ISO 8601 UTC, or null
}

export interface CachedMerchant {
  readonly userId: string;
  readonly label: string;
  readonly updatedAt: string;
}

// ----------------------------------------------------------------
// Init / migrations
// ----------------------------------------------------------------

/**
 * Open (or create) the oneto_ledger database and run any pending migrations.
 * Must be called exactly once at app boot, before any other ledger function.
 */
export function initDb(): void {
  // openDatabaseSync creates the file if it doesn't exist (expo-sqlite v16).
  db = SQLite.openDatabaseSync("oneto_ledger.db");

  // Migration 1: initial schema.
  // CREATE TABLE IF NOT EXISTS is idempotent — safe to run on every boot.
  getDb().execSync(`
    CREATE TABLE IF NOT EXISTS pending_transactions (
      id TEXT PRIMARY KEY,
      envelope_json TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      recipient_label TEXT,
      amount_kobo INTEGER NOT NULL,
      sequence_number INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
      status TEXT NOT NULL DEFAULT 'pending_reconciliation'
        CHECK (status IN ('pending_reconciliation', 'reconciled', 'rejected')),
      created_at TEXT NOT NULL,
      reconciled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS local_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_merchants (
      user_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// ----------------------------------------------------------------
// Transactions
// ----------------------------------------------------------------

/**
 * Insert a new pending transaction (outgoing or incoming) into the ledger.
 *
 * Idempotent via PRIMARY KEY: inserting the same transactionId twice
 * throws a UNIQUE constraint error from SQLite, which is the correct
 * behaviour — a duplicate insert is a sign of a bug, not a retry.
 */
export function insertPendingTransaction(tx: {
  id: string;
  envelopeJson: string;
  recipientId: string;
  recipientLabel: string | undefined;
  amountKobo: number;
  sequenceNumber: number;
  direction: "outgoing" | "incoming";
  createdAt: string;
}): void {
  // Validate kobo is integer (belt-and-suspenders — callers should ensure this)
  if (!Number.isInteger(tx.amountKobo) || tx.amountKobo <= 0) {
    throw new Error(
      `insertPendingTransaction: amountKobo must be a positive integer, got ${tx.amountKobo}`,
    );
  }

  getDb().runSync(
    `INSERT INTO pending_transactions
       (id, envelope_json, recipient_id, recipient_label,
        amount_kobo, sequence_number, direction, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tx.id,
    tx.envelopeJson,
    tx.recipientId,
    tx.recipientLabel ?? null,
    tx.amountKobo,
    tx.sequenceNumber,
    tx.direction,
    tx.createdAt,
  );
}

/**
 * Sum of all pending outgoing transactions that have not yet been reconciled.
 * Used to compute spendable balance: verifiedBalance - sumPendingOutgoingKobo().
 *
 * Returns 0 if there are no pending outgoing transactions.
 */
export function sumPendingOutgoingKobo(): number {
  const row = getDb().getFirstSync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS total
     FROM pending_transactions
     WHERE direction = 'outgoing' AND status = 'pending_reconciliation'`,
  );
  // COALESCE ensures this is never null, but the type says number | null.
  // Guard defensively.
  return row?.total ?? 0;
}

/**
 * Sum of all pending incoming transactions that have not yet been reconciled.
 * Used by merchant receive flow to estimate projected balance before accepting
 * another offline incoming envelope.
 *
 * Returns 0 if there are no pending incoming transactions.
 */
export function sumPendingIncomingKobo(): number {
  const row = getDb().getFirstSync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS total
     FROM pending_transactions
     WHERE direction = 'incoming' AND status = 'pending_reconciliation'`,
  );
  return row?.total ?? 0;
}

/**
 * Get the next sequence number for a new outgoing envelope.
 *
 * Sequence = MAX(existing outgoing sequence numbers) + 1, or 1 if none.
 * Only outgoing envelopes increment the local sequence counter — incoming
 * envelopes carry the sender's sequence numbers, not ours.
 *
 * Note: on device reinstall, a new keypair is generated and sequences reset
 * to 1. This is correct — the server tracks sequences per public key, not
 * per device. The old key is invalidated on reinstall.
 */
export function getNextSequenceNumber(): number {
  const row = getDb().getFirstSync<{ next: number }>(
    `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next
     FROM pending_transactions
     WHERE direction = 'outgoing'`,
  );
  return row?.next ?? 1;
}

/**
 * List pending transactions, newest first, with pagination.
 * Use for the transaction history screen.
 *
 * @param limit  Max rows to return
 * @param offset Number of rows to skip (for pagination)
 */
export function listPendingTransactions(
  limit: number,
  offset: number,
): PendingTransaction[] {
  const rows = getDb().getAllSync<{
    id: string;
    envelope_json: string;
    recipient_id: string;
    recipient_label: string | null;
    amount_kobo: number;
    sequence_number: number;
    direction: string;
    status: string;
    created_at: string;
    reconciled_at: string | null;
  }>(
    `SELECT id, envelope_json, recipient_id, recipient_label,
            amount_kobo, sequence_number, direction, status,
            created_at, reconciled_at
     FROM pending_transactions
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    limit,
    offset,
  );

  return rows.map((r) => ({
    id: r.id,
    envelopeJson: r.envelope_json,
    recipientId: r.recipient_id,
    recipientLabel: r.recipient_label,
    amountKobo: r.amount_kobo,
    sequenceNumber: r.sequence_number,
    direction: r.direction as "outgoing" | "incoming",
    status: r.status as PendingTransaction["status"],
    createdAt: r.created_at,
    reconciledAt: r.reconciled_at,
  }));
}

/**
 * List pending transactions by status and direction.
 */
export function listPendingByStatus(
  status: string,
  direction: "incoming" | "outgoing",
): PendingTransaction[] {
  const rows = getDb().getAllSync<{
    id: string;
    envelope_json: string;
    recipient_id: string;
    recipient_label: string | null;
    amount_kobo: number;
    sequence_number: number;
    direction: string;
    status: string;
    created_at: string;
    reconciled_at: string | null;
  }>(
    `SELECT id, envelope_json, recipient_id, recipient_label,
            amount_kobo, sequence_number, direction, status,
            created_at, reconciled_at
     FROM pending_transactions
     WHERE status = ? AND direction = ?
     ORDER BY created_at ASC`,
    status,
    direction,
  );

  return rows.map((r) => ({
    id: r.id,
    envelopeJson: r.envelope_json,
    recipientId: r.recipient_id,
    recipientLabel: r.recipient_label,
    amountKobo: r.amount_kobo,
    sequenceNumber: r.sequence_number,
    direction: r.direction as "outgoing" | "incoming",
    status: r.status as PendingTransaction["status"],
    createdAt: r.created_at,
    reconciledAt: r.reconciled_at,
  }));
}

/**
 * Update a transaction's status and set reconciled_at.
 */
export function updateTransactionStatus(
  transactionId: string,
  newStatus: "reconciled" | "rejected",
): void {
  const reconciledAt = new Date().toISOString();
  getDb().runSync(
    `UPDATE pending_transactions
     SET status = ?, reconciled_at = ?
     WHERE id = ?`,
    newStatus,
    reconciledAt,
    transactionId,
  );
}

// ----------------------------------------------------------------
// Cached merchants
// ----------------------------------------------------------------

/**
 * Replace cached merchants atomically for the local student flow.
 * The cache is a full snapshot from the backend endpoint.
 */
export function replaceCachedMerchants(
  merchants: ReadonlyArray<{ userId: string; label: string }>,
): void {
  const dbInstance = getDb();
  const nowIso = new Date().toISOString();

  // Delete+insert runs inside one SQLite transaction so a mid-batch failure
  // rolls everything back and preserves the previous cache snapshot.
  dbInstance.withTransactionSync(() => {
    dbInstance.runSync(`DELETE FROM cached_merchants`);

    for (const merchant of merchants) {
      dbInstance.runSync(
        `INSERT INTO cached_merchants (user_id, label, updated_at)
         VALUES (?, ?, ?)`,
        merchant.userId,
        merchant.label,
        nowIso,
      );
    }
  });
}

/**
 * Read cached merchants sorted by label.
 */
export function listCachedMerchants(): CachedMerchant[] {
  const rows = getDb().getAllSync<{
    user_id: string;
    label: string;
    updated_at: string;
  }>(
    `SELECT user_id, label, updated_at
     FROM cached_merchants
     ORDER BY label ASC`,
  );

  return rows.map((r) => ({
    userId: r.user_id,
    label: r.label,
    updatedAt: r.updated_at,
  }));
}

// ----------------------------------------------------------------
// Local key-value state
// ----------------------------------------------------------------

/**
 * Read an arbitrary local state value.
 * Returns null if the key has never been written.
 *
 * Key examples:
 *   "verified_balance_kobo"  — last server-confirmed balance as a string integer
 *   "last_sync_at"           — ISO 8601 timestamp of last successful GET /me
 */
export function getLocalState(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>(
    `SELECT value FROM local_state WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

/**
 * Write an arbitrary local state value (upsert).
 */
export function setLocalState(key: string, value: string): void {
  getDb().runSync(
    `INSERT INTO local_state (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

/**
 * Testing-only reset helper for local SQLite persistence.
 * Clears pending envelopes, local balance/sync cache, and cached merchants.
 */
export function wipeLocalTestingData(): void {
  // TODO(TESTING_ONLY_REMOVE_BEFORE_USERS): Remove local key/ledger wipe button before production users.
  const dbInstance = getDb();
  dbInstance.withTransactionSync(() => {
    dbInstance.runSync(`DELETE FROM pending_transactions`);
    dbInstance.runSync(`DELETE FROM local_state`);
    dbInstance.runSync(`DELETE FROM cached_merchants`);
  });
}
