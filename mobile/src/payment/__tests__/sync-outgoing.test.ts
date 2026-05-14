import { syncOutgoingPendingFromServerLedger } from "../sync-outgoing";
import { fetchLedger } from "../../api/ledger";
import { listPendingByStatus, updateTransactionStatus } from "../../ledger/db";

jest.mock("../../api/ledger", () => ({
  fetchLedger: jest.fn(),
}));

jest.mock("../../ledger/db", () => ({
  listPendingByStatus: jest.fn(),
  updateTransactionStatus: jest.fn(),
}));

describe("syncOutgoingPendingFromServerLedger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps pending outgoing deducted before server confirmation", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_local_1", amountKobo: 1000, direction: "outgoing" },
    ]);
    (fetchLedger as jest.Mock).mockResolvedValue({
      entries: [],
      nextCursor: null,
    });

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedReconciled: 0 });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });

  it("marks matching local pending outgoing as reconciled once seen on server", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_local_1", amountKobo: 1000, direction: "outgoing" },
    ]);
    (fetchLedger as jest.Mock).mockResolvedValue({
      entries: [
        {
          id: "entry_1",
          transactionId: "tx_local_1",
          type: "DEBIT",
          amountKobo: "1000",
          balanceAfterKobo: "4000",
          description: "Payment",
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedReconciled: 1 });
    expect(updateTransactionStatus).toHaveBeenCalledWith("tx_local_1", "reconciled");
  });

  it("is idempotent when run twice", async () => {
    (listPendingByStatus as jest.Mock)
      .mockReturnValueOnce([{ id: "tx_local_1", amountKobo: 1000, direction: "outgoing" }])
      .mockReturnValueOnce([]);
    (fetchLedger as jest.Mock).mockResolvedValue({
      entries: [
        {
          id: "entry_1",
          transactionId: "tx_local_1",
          type: "DEBIT",
          amountKobo: "1000",
          balanceAfterKobo: "4000",
          description: "Payment",
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    const first = await syncOutgoingPendingFromServerLedger();
    const second = await syncOutgoingPendingFromServerLedger();

    expect(first).toEqual({ markedReconciled: 1 });
    expect(second).toEqual({ markedReconciled: 0 });
    expect(updateTransactionStatus).toHaveBeenCalledTimes(1);
  });

  it("does not reconcile when server transaction is unrelated", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_local_1", amountKobo: 1000, direction: "outgoing" },
    ]);
    (fetchLedger as jest.Mock).mockResolvedValue({
      entries: [
        {
          id: "entry_1",
          transactionId: "tx_other",
          type: "DEBIT",
          amountKobo: "2500",
          balanceAfterKobo: "2500",
          description: "Payment",
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedReconciled: 0 });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });

  it("keeps local pending untouched when offline or ledger fetch fails", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_local_1", amountKobo: 1000, direction: "outgoing" },
    ]);
    (fetchLedger as jest.Mock).mockRejectedValue(new Error("offline"));

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedReconciled: 0 });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });
});

