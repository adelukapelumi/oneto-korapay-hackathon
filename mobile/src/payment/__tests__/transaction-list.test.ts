import { mergeTransactions } from "../transaction-list";
import { listPendingTransactions } from "../../ledger/db";
import type { LedgerEntry } from "../../api/ledger";

jest.mock("../../ledger/db", () => ({
  listPendingTransactions: jest.fn(),
}));

describe("mergeTransactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      },
      {
        id: "tx_456", // Doesn't match
        direction: "outgoing",
        amountKobo: 2000,
        recipientLabel: "Merchant 2",
        createdAt: new Date("2023-01-01T12:00:00Z").toISOString(),
        status: "pending_reconciliation",
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
