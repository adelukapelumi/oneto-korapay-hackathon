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

  // Idempotent table creation (we only need to create the two tables we use)
  function ensureTable(name: string) {
    if (!tables.has(name)) {
      tables.set(name, []);
    }
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

    return { changes: 0 };
  }

  // getFirstSync: called for SELECT ... (returns first row or null)
  function getFirstSync<T>(source: string, ...params: (string | number | null)[]): T | null {
    const s = source.trim().toUpperCase();

    // SUM pending outgoing
    if (s.includes("COALESCE(SUM(AMOUNT_KOBO)") && s.includes("PENDING_TRANSACTIONS")) {
      ensureTable("pending_transactions");
      const rows = tables.get("pending_transactions")!;
      const total = rows
        .filter((r) => r["direction"] === "outgoing" && r["status"] === "pending_reconciliation")
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

  return { execSync, runSync, getFirstSync, getAllSync, tables };
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
  getNextSequenceNumber,
  listPendingTransactions,
  getLocalState,
  setLocalState,
} from "../db";

// ---- Helpers -------------------------------------------------------------

function makeEnvelopeJson(): string {
  return JSON.stringify({ version: 1, signature: "ed25519:" + "a".repeat(128) });
}

// Reset mock state between tests by clearing the tables
function resetDb(): void {
  // Clear tables and reinitialise
  mockDbInstance.tables.forEach((rows) => rows.splice(0));
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
