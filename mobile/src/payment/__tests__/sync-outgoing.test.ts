import { syncOutgoingPendingFromServerLedger } from "../sync-outgoing";
import { fetchOutgoingStatuses } from "../../api/outgoing-status";
import { listPendingByStatus, updateTransactionStatus } from "../../ledger/db";

jest.mock("../../api/outgoing-status", () => ({
  fetchOutgoingStatuses: jest.fn(),
}));

jest.mock("../../ledger/db", () => ({
  listPendingByStatus: jest.fn(),
  updateTransactionStatus: jest.fn(),
}));

describe("syncOutgoingPendingFromServerLedger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps pending outgoing deducted before backend terminal confirmation", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      },
    ]);
    (fetchOutgoingStatuses as jest.Mock).mockResolvedValue([
      { transactionId: "tx_local_1", status: "unknown_pending" },
    ]);

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 0 });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });

  it("marks matching local pending outgoing as reconciled once backend confirms settlement", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      },
    ]);
    (fetchOutgoingStatuses as jest.Mock).mockResolvedValue([
      { transactionId: "tx_local_1", status: "reconciled" },
    ]);

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 1 });
    expect(updateTransactionStatus).toHaveBeenCalledWith("tx_local_1", "reconciled");
  });

  it("clears the hold when backend confirms expired_unclaimed", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      },
    ]);
    (fetchOutgoingStatuses as jest.Mock).mockResolvedValue([
      { transactionId: "tx_local_1", status: "expired_unclaimed" },
    ]);

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 1 });
    expect(updateTransactionStatus).toHaveBeenCalledWith(
      "tx_local_1",
      "rejected",
      "expired_unclaimed",
    );
  });

  it("stores generic backend rejections as terminal local rejections", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      },
    ]);
    (fetchOutgoingStatuses as jest.Mock).mockResolvedValue([
      {
        transactionId: "tx_local_1",
        status: "rejected",
        reason: "public_key_unknown",
      },
    ]);

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 1 });
    expect(updateTransactionStatus).toHaveBeenCalledWith(
      "tx_local_1",
      "rejected",
      "public_key_unknown",
    );
  });

  it("is idempotent when run twice", async () => {
    (listPendingByStatus as jest.Mock)
      .mockReturnValueOnce([{
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      }])
      .mockReturnValueOnce([]);
    (fetchOutgoingStatuses as jest.Mock).mockResolvedValue([
      { transactionId: "tx_local_1", status: "reconciled" },
    ]);

    const first = await syncOutgoingPendingFromServerLedger();
    const second = await syncOutgoingPendingFromServerLedger();

    expect(first).toEqual({ markedTerminal: 1 });
    expect(second).toEqual({ markedTerminal: 0 });
    expect(updateTransactionStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps malformed local envelopes locked instead of releasing them", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: "{bad json",
      },
    ]);

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 0 });
    expect(fetchOutgoingStatuses).not.toHaveBeenCalled();
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });

  it("keeps local pending untouched when offline or status fetch fails", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([
      {
        id: "tx_local_1",
        amountKobo: 1000,
        direction: "outgoing",
        envelopeJson: JSON.stringify({ transactionId: "tx_local_1" }),
      },
    ]);
    (fetchOutgoingStatuses as jest.Mock).mockRejectedValue(new Error("offline"));

    const result = await syncOutgoingPendingFromServerLedger();

    expect(result).toEqual({ markedTerminal: 0 });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });
});
