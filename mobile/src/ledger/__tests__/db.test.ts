// Tests for mobile/src/ledger/db.ts
//
// expo-sqlite uses native SQLite which can't run in Jest/Node. We replace it
// with an in-memory mock that mirrors the real API surface:
//   openDatabaseSync(name) → { execSync, runSync, getFirstSync, getAllSync }
//
// The mock uses a map of maps to simulate tables. It interprets a minimal
// subset of SQL so we can test our exact queries without a real DB engine.
// We are NOT testing SQL correctness — we are testing our Typescript logic
// around the DB calls (sequence math, sum aggregation, direction filtering,
// ordering).

// ---- Mock expo-sqlite ---------------------------------------------------

interface MockRow {
  [column: string]: string | number | null;
}

// Per-table storage: tableName → array of row objects
type TableStore = Map<string, MockRow[]>;

// Create a fresh mock DB instance (in-memory)
function createMockDb() {
  const tables: TableStore = new Map();
  let failCachedMerchantInsertForUserId: string | null = null;

  // Idempotent table creation (we only need to create the two tables we use)
  function ensureTable(name: string) {
    if (!tables.has(name)) {
      tables.set(name, []);
    }
  }

  function cloneTables(source: TableStore): TableStore {
    const copy: TableStore = new Map();
    source.forEach((rows, name) => {
      copy.set(
        name,
        rows.map((row) => ({ ...row })),
      );
    });
    return copy;
  }

  // execSync: called for CREATE TABLE IF NOT EXISTS etc. We parse table names.
  function execSync(source: string): void {
    // Extract table names from CREATE TABLE IF NOT EXISTS statements
    const createRe = /CREATE TABLE IF NOT EXISTS (\w+)/gi;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(source)) !== null) {
      ensureTable(match[1] as string);
    }
  }

  // runSync: called for INSERT / UPDATE statements
  function runSync(source: string, ...params: (string | number | null)[]): { changes: number } {
    const s = source.trim().toUpperCase();

    // INSERT INTO pending_transactions
    if (s.startsWith("INSERT INTO PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const [id, envelope_json, recipient_id, recipient_label,
        amount_kobo, sequence_number, direction, created_at] = params;
      // Check primary key uniqueness
      if (rows.some((r) => r["id"] === id)) {
        throw new Error("UNIQUE constraint failed: pending_transactions.id");
      }
      rows.push({
        id: id as string,
        envelope_json: envelope_json as string,
        recipient_id: recipient_id as string,
        recipient_label: (recipient_label ?? null) as string | null,
        amount_kobo: amount_kobo as number,
        sequence_number: sequence_number as number,
        direction: direction as string,
        status: "pending_reconciliation",
        created_at: created_at as string,
        reconciled_at: null,
      });
      return { changes: 1 };
    }

    // INSERT INTO local_state ... ON CONFLICT DO UPDATE
    if (s.startsWith("INSERT INTO LOCAL_STATE")) {
      ensureTable("local_state");
      const rows = tables.get("local_state")!;
      const [key, value] = params;
      const existing = rows.findIndex((r) => r["key"] === key);
      if (existing >= 0) {
        rows[existing]!["value"] = value as string;
      } else {
        rows.push({ key: key as string, value: value as string });
      }
      return { changes: 1 };
    }

    if (s.startsWith("UPDATE PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const [newStatus, reconciledAt, transactionId] = params;
      const row = rows.find((r) => r["id"] === transactionId);
      if (row) {
        row["status"] = newStatus as string;
        row["reconciled_at"] = reconciledAt as string;
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (s.startsWith("DELETE FROM CACHED_MERCHANTS")) {
      ensureTable("cached_merchants");
      const rows = tables.get("cached_merchants")!;
      const before = rows.length;
      rows.splice(0);
      return { changes: before };
    }

    if (s.startsWith("DELETE FROM PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const before = rows.length;
      rows.splice(0);
      return { changes: before };
    }

    if (s.startsWith("DELETE FROM LOCAL_STATE")) {
      ensureTable("local_state");
      const rows = tables.get("local_state")!;
      const before = rows.length;
      rows.splice(0);
      return { changes: before };
    }

    if (s.startsWith("INSERT INTO CACHED_MERCHANTS")) {
      ensureTable("cached_merchants");
      const rows = tables.get("cached_merchants")!;
      const [user_id, label, updated_at] = params;
      if (
        failCachedMerchantInsertForUserId !== null &&
        user_id === failCachedMerchantInsertForUserId
      ) {
        throw new Error("Mock cached merchant insert failure");
      }
      if (rows.some((r) => r["user_id"] === user_id)) {
        throw new Error("UNIQUE constraint failed: cached_merchants.user_id");
      }
      rows.push({
        user_id: user_id as string,
        label: label as string,
        updated_at: updated_at as string,
      });
      return { changes: 1 };
    }

    return { changes: 0 };
  }

  // getFirstSync: called for SELECT ... (returns first row or null)
  function getFirstSync<T>(source: string, ...params: (string | number | null)[]): T | null {
    const s = source.trim().toUpperCase();

    // SUM pending outgoing/incoming
    if (s.includes("COALESCE(SUM(AMOUNT_KOBO)") && s.includes("PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const direction: "incoming" | "outgoing" =
        s.includes("DIRECTION = 'INCOMING'") ? "incoming" : "outgoing";
      const total = rows
        .filter((r) => r["direction"] === direction && r["status"] === "pending_reconciliation")
        .reduce((sum, r) => sum + (r["amount_kobo"] as number), 0);
      return { total } as unknown as T;
    }

    // Next sequence number
    if (s.includes("COALESCE(MAX(SEQUENCE_NUMBER)") && s.includes("PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const outgoing = rows.filter((r) => r["direction"] === "outgoing");
      const maxSeq = outgoing.length === 0
        ? 0
        : Math.max(...outgoing.map((r) => r["sequence_number"] as number));
      return { next: maxSeq + 1 } as unknown as T;
    }

    // local_state SELECT
    if (s.includes("SELECT VALUE FROM LOCAL_STATE")) {
      ensureTable("local_state");
      const rows = tables.get("local_state")!;
      const key = params[0];
      const row = rows.find((r) => r["key"] === key);
      return row ? ({ value: row["value"] } as unknown as T) : null;
    }

    return null;
  }

  // getAllSync: called for paginated SELECT
  function getAllSync<T>(source: string, ...params: (string | number | null)[]): T[] {
    const s = source.trim().toUpperCase();

    if (s.includes("WHERE STATUS = ? AND DIRECTION = ?")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const status = params[0] as string;
      const direction = params[1] as string;
      const filtered = rows.filter((r) => r["status"] === status && r["direction"] === direction);
      // Sort by created_at ASC
      const sorted = [...filtered].sort((a, b) => {
        const aDate = a["created_at"] as string;
        const bDate = b["created_at"] as string;
        return aDate.localeCompare(bDate);
      });
      return sorted as unknown as T[];
    }

    if (s.includes("FROM CACHED_MERCHANTS")) {
      ensureTable("cached_merchants");
      const rows = tables.get("cached_merchants")!;
      const sorted = [...rows].sort((a, b) => {
        const aLabel = a["label"] as string;
        const bLabel = b["label"] as string;
        return aLabel.localeCompare(bLabel);
      });
      return sorted as unknown as T[];
    }

    if (s.includes("FROM PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      // Sort by created_at DESC
      const sorted = [...rows].sort((a, b) => {
        const aDate = a["created_at"] as string;
        const bDate = b["created_at"] as string;
        return bDate.localeCompare(aDate);
      });
      const limit = params[0] as number;
      const offset = params[1] as number;
      return sorted.slice(offset, offset + limit) as unknown as T[];
    }

    return [];
  }

  function withTransactionSync(task: () => void): void {
    const snapshot = cloneTables(tables);
    try {
      task();
    } catch (error) {
      tables.clear();
      snapshot.forEach((rows, name) => {
        tables.set(name, rows);
      });
      throw error;
    }
  }

  function setFailCachedMerchantInsertForUserId(userId: string | null): void {
    failCachedMerchantInsertForUserId = userId;
  }

  return {
    execSync,
    runSync,
    getFirstSync,
    getAllSync,
    withTransactionSync,
    setFailCachedMerchantInsertForUserId,
    tables,
  };
}

// Jest mock for expo-sqlite
const mockDbInstance = createMockDb();

jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => mockDbInstance),
}));

// ---- Import module under test AFTER the mock is set up ------------------

import {
  initDb,
  insertPendingTransaction,
  sumPendingOutgoingKobo,
  sumPendingIncomingKobo,
  getNextSequenceNumber,
  listPendingTransactions,
  getLocalState,
  setLocalState,
  listPendingByStatus,
  updateTransactionStatus,
  listCachedMerchants,
  replaceCachedMerchants,
  wipeLocalTestingData,
} from "../db";

// ---- Helpers -------------------------------------------------------------

function makeEnvelopeJson(): string {
  return JSON.stringify({ version: 1, signature: "ed25519:" + "a".repeat(128) });
}

// Reset mock state between tests by clearing the tables
function resetDb(): void {
  // Clear tables and reinitialise
  mockDbInstance.tables.forEach((rows) => rows.splice(0));
  mockDbInstance.setFailCachedMerchantInsertForUserId(null);
  initDb();
}

// ---- Tests ---------------------------------------------------------------

describe("initDb", () => {
  it("calls openDatabaseSync and runs CREATE TABLE migrations", () => {
    const SQLite = jest.requireMock("expo-sqlite") as { openDatabaseSync: jest.Mock };
    SQLite.openDatabaseSync.mockClear();
    initDb();
    expect(SQLite.openDatabaseSync).toHaveBeenCalledWith("oneto_ledger.db");
  });
});

describe("insertPendingTransaction", () => {
  beforeEach(() => resetDb());

  it("inserts a transaction and it appears in the table", () => {
    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: "Buka Express",
      amountKobo: 50_000,
      sequenceNumber: 1,
      direction: "outgoing",
      createdAt: new Date().toISOString(),
    });
    const rows = mockDbInstance.tables.get("pending_transactions")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["id"]).toBe("tx_0000000000000001");
    expect(rows[0]!["amount_kobo"]).toBe(50_000);
    expect(rows[0]!["direction"]).toBe("outgoing");
  });

  it("throws on duplicate transactionId (PRIMARY KEY enforcement)", () => {
    const tx = {
      id: "tx_0000000000000002",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 1,
      direction: "outgoing" as const,
      createdAt: new Date().toISOString(),
    };
    insertPendingTransaction(tx);
    expect(() => insertPendingTransaction(tx)).toThrow(/UNIQUE constraint/);
  });

  it("rejects non-integer amountKobo", () => {
    expect(() =>
      insertPendingTransaction({
        id: "tx_0000000000000003",
        envelopeJson: makeEnvelopeJson(),
        recipientId: "u_abcdef0123456789",
        recipientLabel: undefined,
        amountKobo: 500.5, // float — bug
        sequenceNumber: 1,
        direction: "outgoing",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow(/must be a positive integer/);
  });
});

describe("sumPendingOutgoingKobo", () => {
  beforeEach(() => resetDb());

  it("returns 0 when there are no outgoing transactions", () => {
    expect(sumPendingOutgoingKobo()).toBe(0);
  });

  it("sums only outgoing pending transactions", () => {
    const now = new Date().toISOString();
    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 30_000,
      sequenceNumber: 1,
      direction: "outgoing",
      createdAt: now,
    });
    insertPendingTransaction({
      id: "tx_0000000000000002",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 20_000,
      sequenceNumber: 2,
      direction: "outgoing",
      createdAt: now,
    });
    expect(sumPendingOutgoingKobo()).toBe(50_000);
  });

  it("does not count reconciled outgoing transactions", () => {
    insertPendingTransaction({
      id: "tx_0000000000000201",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000001",
      recipientLabel: "Pilot Buka",
      amountKobo: 150_000,
      sequenceNumber: 1,
      direction: "outgoing",
      createdAt: "2026-05-01T10:00:00.000Z",
    });

    updateTransactionStatus("tx_0000000000000201", "reconciled");

    expect(sumPendingOutgoingKobo()).toBe(0);
  });

  it("does not count rejected outgoing transactions", () => {
    insertPendingTransaction({
      id: "tx_0000000000000202",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000002",
      recipientLabel: "Cafe 24",
      amountKobo: 150_000,
      sequenceNumber: 2,
      direction: "outgoing",
      createdAt: "2026-05-01T11:00:00.000Z",
    });

    updateTransactionStatus("tx_0000000000000202", "rejected");

    expect(sumPendingOutgoingKobo()).toBe(0);
  });
});

describe("sumPendingIncomingKobo", () => {
  beforeEach(() => resetDb());

  it("returns 0 when there are no incoming transactions", () => {
    expect(sumPendingIncomingKobo()).toBe(0);
  });

  it("sums only incoming pending transactions", () => {
    const now = new Date().toISOString();
    insertPendingTransaction({
      id: "tx_0000000000000101",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000001",
      recipientLabel: undefined,
      amountKobo: 30_000,
      sequenceNumber: 1,
      direction: "incoming",
      createdAt: now,
    });
    insertPendingTransaction({
      id: "tx_0000000000000102",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000001",
      recipientLabel: undefined,
      amountKobo: 20_000,
      sequenceNumber: 2,
      direction: "incoming",
      createdAt: now,
    });
    insertPendingTransaction({
      id: "tx_0000000000000103",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_student0000000001",
      recipientLabel: undefined,
      amountKobo: 99_000,
      sequenceNumber: 3,
      direction: "outgoing",
      createdAt: now,
    });

    expect(sumPendingIncomingKobo()).toBe(50_000);
  });

  it("does not count already reconciled incoming transactions", () => {
    insertPendingTransaction({
      id: "tx_0000000000000104",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000001",
      recipientLabel: undefined,
      amountKobo: 40_000,
      sequenceNumber: 1,
      direction: "incoming",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    insertPendingTransaction({
      id: "tx_0000000000000105",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000001",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 2,
      direction: "incoming",
      createdAt: "2026-05-01T11:00:00.000Z",
    });

    updateTransactionStatus("tx_0000000000000104", "reconciled");

    expect(sumPendingIncomingKobo()).toBe(10_000);
  });
});

describe("getNextSequenceNumber", () => {
  beforeEach(() => resetDb());

  it("returns 1 when no outgoing transactions exist", () => {
    expect(getNextSequenceNumber()).toBe(1);
  });

  it("increments correctly after each outgoing insert", () => {
    const now = new Date().toISOString();
    expect(getNextSequenceNumber()).toBe(1);

    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 1,
      direction: "outgoing",
      createdAt: now,
    });

    expect(getNextSequenceNumber()).toBe(2);

    insertPendingTransaction({
      id: "tx_0000000000000002",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 2,
      direction: "outgoing",
      createdAt: now,
    });

    expect(getNextSequenceNumber()).toBe(3);
  });
});

describe("listPendingTransactions", () => {
  beforeEach(() => resetDb());

  it("returns transactions newest first", () => {
    const t1 = "2026-05-01T10:00:00.000Z";
    const t2 = "2026-05-01T11:00:00.000Z"; // newer
    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 1,
      direction: "outgoing",
      createdAt: t1,
    });
    insertPendingTransaction({
      id: "tx_0000000000000002",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 20_000,
      sequenceNumber: 2,
      direction: "outgoing",
      createdAt: t2,
    });

    const result = listPendingTransactions(10, 0);
    expect(result).toHaveLength(2);
    // Newest first: t2 > t1
    expect(result[0]!.id).toBe("tx_0000000000000002");
    expect(result[1]!.id).toBe("tx_0000000000000001");
  });

  it("respects limit and offset", () => {
    const now = new Date().toISOString();
    for (let i = 1; i <= 5; i++) {
      insertPendingTransaction({
        id: `tx_000000000000000${i}`,
        envelopeJson: makeEnvelopeJson(),
        recipientId: "u_abcdef0123456789",
        recipientLabel: undefined,
        amountKobo: 10_000 * i,
        sequenceNumber: i,
        direction: "outgoing",
        createdAt: now,
      });
    }
    const page1 = listPendingTransactions(2, 0);
    const page2 = listPendingTransactions(2, 2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    // Pages don't overlap
    const ids1 = page1.map((r) => r.id);
    const ids2 = page2.map((r) => r.id);
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
  });
});

describe("getLocalState / setLocalState", () => {
  beforeEach(() => resetDb());

  it("returns null for a key that was never set", () => {
    expect(getLocalState("never_set")).toBeNull();
  });

  it("stores and retrieves a string value", () => {
    setLocalState("verified_balance_kobo", "500000");
    expect(getLocalState("verified_balance_kobo")).toBe("500000");
  });

  it("overwrites an existing key on second write (upsert)", () => {
    setLocalState("verified_balance_kobo", "100000");
    setLocalState("verified_balance_kobo", "200000");
    expect(getLocalState("verified_balance_kobo")).toBe("200000");
  });
});

describe("listPendingByStatus", () => {
  beforeEach(() => resetDb());

  it("returns filtered transactions sorted ASC", () => {
    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 1,
      direction: "incoming",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    insertPendingTransaction({
      id: "tx_0000000000000002",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 20_000,
      sequenceNumber: 2,
      direction: "incoming",
      createdAt: "2026-05-01T11:00:00.000Z",
    });
    insertPendingTransaction({
      id: "tx_0000000000000003",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 20_000,
      sequenceNumber: 3,
      direction: "outgoing", // wrong direction
      createdAt: "2026-05-01T12:00:00.000Z",
    });

    const result = listPendingByStatus("pending_reconciliation", "incoming");
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("tx_0000000000000001"); // oldest first
    expect(result[1]!.id).toBe("tx_0000000000000002");
  });
});

describe("updateTransactionStatus", () => {
  beforeEach(() => resetDb());

  it("updates status and reconciledAt", () => {
    insertPendingTransaction({
      id: "tx_0000000000000001",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_abcdef0123456789",
      recipientLabel: undefined,
      amountKobo: 10_000,
      sequenceNumber: 1,
      direction: "incoming",
      createdAt: "2026-05-01T10:00:00.000Z",
    });

    updateTransactionStatus("tx_0000000000000001", "reconciled");

    const rows = mockDbInstance.tables.get("pending_transactions")!;
    expect(rows[0]!["status"]).toBe("reconciled");
    expect(rows[0]!["reconciled_at"]).not.toBeNull();
  });
});

describe("cached merchants", () => {
  beforeEach(() => resetDb());

  it("replaces cache snapshot and returns entries sorted by label", () => {
    replaceCachedMerchants([
      { userId: "u_bbbbbbbbbbbbbbbb", label: "Zulu Kitchen" },
      { userId: "u_aaaaaaaaaaaaaaaa", label: "Bookshop" },
    ]);

    const merchants = listCachedMerchants();
    expect(merchants).toHaveLength(2);
    expect(merchants[0]!.label).toBe("Bookshop");
    expect(merchants[1]!.label).toBe("Zulu Kitchen");
  });

  it("clears old cache entries on replacement", () => {
    replaceCachedMerchants([
      { userId: "u_aaaaaaaaaaaaaaaa", label: "Old Merchant" },
    ]);
    replaceCachedMerchants([
      { userId: "u_cccccccccccccccc", label: "New Merchant" },
    ]);

    const merchants = listCachedMerchants();
    expect(merchants).toHaveLength(1);
    expect(merchants[0]!.userId).toBe("u_cccccccccccccccc");
    expect(merchants[0]!.label).toBe("New Merchant");
  });

  it("rolls back replacement when an insert fails", () => {
    replaceCachedMerchants([
      { userId: "u_oldmerchant000001", label: "Old Merchant 1" },
      { userId: "u_oldmerchant000002", label: "Old Merchant 2" },
    ]);

    mockDbInstance.setFailCachedMerchantInsertForUserId("u_failmerchant0001");

    expect(() =>
      replaceCachedMerchants([
        { userId: "u_newmerchant000001", label: "New Merchant 1" },
        { userId: "u_failmerchant0001", label: "Will Fail" },
      ]),
    ).toThrow(/Mock cached merchant insert failure/);

    const merchants = listCachedMerchants();
    expect(merchants).toHaveLength(2);
    expect(merchants[0]!.userId).toBe("u_oldmerchant000001");
    expect(merchants[1]!.userId).toBe("u_oldmerchant000002");
  });
});

describe("wipeLocalTestingData", () => {
  beforeEach(() => resetDb());

  it("clears pending transactions, local state, and cached merchants together", () => {
    insertPendingTransaction({
      id: "tx_0000000000000999",
      envelopeJson: makeEnvelopeJson(),
      recipientId: "u_merchant000000009",
      recipientLabel: "Pilot Buka",
      amountKobo: 15_000,
      sequenceNumber: 4,
      direction: "outgoing",
      createdAt: "2026-05-01T13:00:00.000Z",
    });
    setLocalState("verified_balance_kobo", "75000");
    setLocalState("last_sync_at", "2026-05-01T13:05:00.000Z");
    replaceCachedMerchants([
      { userId: "u_merchant000000009", label: "Pilot Buka" },
    ]);

    wipeLocalTestingData();

    expect(mockDbInstance.tables.get("pending_transactions")).toHaveLength(0);
    expect(mockDbInstance.tables.get("local_state")).toHaveLength(0);
    expect(mockDbInstance.tables.get("cached_merchants")).toHaveLength(0);
  });
});
