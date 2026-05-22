import {
  buildTransactionDisplayRows,
  mergeTransactions,
  toTransactionDisplayRow,
  type DisplayTransaction,
} from "../transaction-list";
import { listCachedMerchants, listPendingTransactions } from "../../ledger/db";
import type { LedgerEntry } from "../../api/ledger";

jest.mock("../../ledger/db", () => ({
  listCachedMerchants: jest.fn(),
  listPendingTransactions: jest.fn(),
}));

describe("mergeTransactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listCachedMerchants as jest.Mock).mockReturnValue([]);
  });

  it("returns empty list when both server and local are empty", () => {
    (listPendingTransactions as jest.Mock).mockReturnValue([]);
    expect(mergeTransactions([])).toEqual([]);
  });

  it("deduplicates local entries when server has same transactionId", () => {
    const serverEntries: LedgerEntry[] = [
      {
        id: "entry_1",
        transactionId: "tx_123",
        type: "DEBIT",
        amountKobo: "5000",
        balanceAfterKobo: "10000",
        description: "Payment",
        createdAt: new Date("2023-01-02T00:00:00Z").toISOString(),
      },
    ];

    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_123", // Matches server
        direction: "outgoing",
        amountKobo: 5000,
        recipientLabel: "Merchant",
        createdAt: new Date("2023-01-01T00:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
      {
        id: "tx_456", // Doesn't match
        direction: "outgoing",
        amountKobo: 2000,
        recipientLabel: "Merchant 2",
        createdAt: new Date("2023-01-01T12:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const result = mergeTransactions(serverEntries);

    expect(result).toHaveLength(2);
    // tx_456 should be there as source local
    expect(result.some((r) => r.id === "tx_456" && r.source === "local")).toBe(true);
    // entry_1 should be there as source server
    expect(result.some((r) => r.id === "entry_1" && r.source === "server")).toBe(true);
    // tx_123 (local) should NOT be there
    expect(result.some((r) => r.id === "tx_123" && r.source === "local")).toBe(false);
  });

  it("sorts entries by newest first", () => {
    const serverEntries: LedgerEntry[] = [
      {
        id: "entry_old",
        transactionId: "tx_old",
        type: "DEBIT",
        amountKobo: "100",
        balanceAfterKobo: "100",
        description: "Old",
        createdAt: new Date("2023-01-01T00:00:00Z").toISOString(),
      },
      {
        id: "entry_new",
        transactionId: "tx_new",
        type: "CREDIT",
        amountKobo: "200",
        balanceAfterKobo: "300",
        description: "New",
        createdAt: new Date("2023-01-03T00:00:00Z").toISOString(),
      },
    ];

    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_mid",
        direction: "incoming",
        amountKobo: 150,
        recipientLabel: "Mid",
        createdAt: new Date("2023-01-02T00:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const result = mergeTransactions(serverEntries);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("entry_new");
    expect(result[1]!.id).toBe("tx_mid");
    expect(result[2]!.id).toBe("entry_old");
  });

  it("includes local-only entries when server list is empty", () => {
    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_1",
        direction: "outgoing",
        amountKobo: 500,
        recipientLabel: "Test",
        createdAt: new Date().toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const result = mergeTransactions([]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("local");
  });

  it("passes localLimit to listPendingTransactions", () => {
    (listPendingTransactions as jest.Mock).mockReturnValue([]);
    mergeTransactions([], 10);
    expect(listPendingTransactions).toHaveBeenCalledWith(10, 0);
  });
});

describe("transaction display rows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listCachedMerchants as jest.Mock).mockReturnValue([]);
  });

  it("includes local pending outgoing rows when server ledger is empty", () => {
    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_pending",
        direction: "outgoing",
        amountKobo: 100000,
        recipientLabel: "Cafeteria",
        createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const rows = buildTransactionDisplayRows([], { limit: 5 });

    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      id: "tx_pending",
      title: "Payment to Cafeteria",
      statusLabel: "Pending",
      statusTone: "pending",
      statusIcon: "hourglass",
      amountDirection: "debit",
    });
  });

  it("sorts a newer pending outgoing row before older server entries", () => {
    const serverEntries: LedgerEntry[] = [
      {
        id: "entry_old",
        transactionId: "tx_old",
        type: "DEBIT",
        amountKobo: "5000",
        balanceAfterKobo: "95000",
        description: "Payment to u_oldmerchant",
        createdAt: new Date("2026-05-22T08:00:00Z").toISOString(),
      },
    ];

    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_newer",
        direction: "outgoing",
        amountKobo: 2000,
        recipientLabel: "Bookshop",
        createdAt: new Date("2026-05-22T09:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const rows = buildTransactionDisplayRows(serverEntries, { limit: 5 });

    expect(rows.map((row) => row.id)).toEqual(["tx_newer", "entry_old"]);
  });

  it("dedupes local pending rows when a server entry has the same transactionId", () => {
    const serverEntries: LedgerEntry[] = [
      {
        id: "entry_confirmed",
        transactionId: "tx_same",
        type: "DEBIT",
        amountKobo: "5000",
        balanceAfterKobo: "95000",
        description: "Payment to u_merchant",
        createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      },
    ];

    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_same",
        direction: "outgoing",
        amountKobo: 5000,
        recipientLabel: "Cafeteria",
        createdAt: new Date("2026-05-22T09:59:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const rows = buildTransactionDisplayRows(serverEntries, { limit: 5 });

    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      id: "entry_confirmed",
      source: "server",
      statusLabel: "Confirmed",
      statusIcon: "check",
    });
  });

  it("uses confirmed check status for server entries", () => {
    const serverTx: DisplayTransaction = {
      source: "server",
      id: "entry_1",
      transactionId: "tx_1",
      type: "CREDIT",
      amountKobo: "1000",
      balanceAfterKobo: "1000",
      description: "Payment from u_student",
      createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      status: "confirmed",
    };

    expect(toTransactionDisplayRow(serverTx)).toMatchObject({
      title: "Payment from student",
      statusLabel: "Confirmed",
      statusTone: "confirmed",
      statusIcon: "check",
      amountDirection: "credit",
    });
  });

  it("maps a known merchant id in server descriptions to the cached merchant label", () => {
    const serverTx: DisplayTransaction = {
      source: "server",
      id: "entry_1",
      transactionId: "tx_1",
      type: "DEBIT",
      amountKobo: "1000",
      balanceAfterKobo: "1000",
      description: "Payment to u_merchant123",
      createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      status: "confirmed",
    };

    const row = toTransactionDisplayRow(
      serverTx,
      new Map([["u_merchant123", "Cafeteria"]]),
    );

    expect(row.title).toBe("Payment to Cafeteria");
  });

  it("does not expose a raw user id for local pending rows without a label", () => {
    const localTx: DisplayTransaction = {
      source: "local",
      id: "tx_pending",
      direction: "outgoing",
      amountKobo: 1000,
      recipientLabel: "u_merchant123",
      createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      status: "pending_reconciliation",
      terminalReason: null,
    };

    const row = toTransactionDisplayRow(localTx);

    expect(row.title).toBe("Payment to merchant");
    expect(row.title).not.toContain("u_merchant123");
  });

  it("sanitizes raw user ids in server payment descriptions when no name is available", () => {
    const serverTx: DisplayTransaction = {
      source: "server",
      id: "entry_1",
      transactionId: "tx_1",
      type: "DEBIT",
      amountKobo: "1000",
      balanceAfterKobo: "1000",
      description: "Payment to u_merchant123",
      createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      status: "confirmed",
    };

    const row = toTransactionDisplayRow(serverTx);

    expect(row.title).toBe("Payment to merchant");
    expect(row.title).not.toContain("u_merchant123");
  });

  it("keeps expired outgoing rows in the released display state", () => {
    const localTx: DisplayTransaction = {
      source: "local",
      id: "tx_expired",
      direction: "outgoing",
      amountKobo: 1000,
      recipientLabel: "Cafeteria",
      createdAt: new Date("2026-05-22T10:00:00Z").toISOString(),
      status: "rejected",
      terminalReason: "expired_unclaimed",
    };

    expect(toTransactionDisplayRow(localTx)).toMatchObject({
      title: "Payment expired unclaimed",
      statusLabel: "Released",
      statusTone: "released",
      statusIcon: "released",
      amountDirection: "credit",
    });
  });

  it("limits dashboard-style rows to the requested recent count", () => {
    (listPendingTransactions as jest.Mock).mockReturnValue([
      {
        id: "tx_local",
        direction: "outgoing",
        amountKobo: 1000,
        recipientLabel: "Cafeteria",
        createdAt: new Date("2026-05-22T12:00:00Z").toISOString(),
        status: "pending_reconciliation",
        terminalReason: null,
      },
    ]);

    const serverEntries: LedgerEntry[] = Array.from({ length: 6 }, (_, index) => ({
      id: `entry_${index}`,
      transactionId: `tx_${index}`,
      type: "CREDIT",
      amountKobo: "100",
      balanceAfterKobo: "1000",
      description: "Top-up via Korapay top_123",
      createdAt: new Date(`2026-05-22T1${index}:00:00Z`).toISOString(),
    }));

    const rows = buildTransactionDisplayRows(serverEntries, {
      localLimit: 5,
      limit: 5,
    });

    expect(rows).toHaveLength(5);
  });
});
