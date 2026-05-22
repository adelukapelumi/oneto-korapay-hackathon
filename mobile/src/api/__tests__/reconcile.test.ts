import { syncPendingEnvelopes } from "../reconcile";
import { apiClient } from "../client";
import { NetworkError } from "../errors";
import { listPendingByStatus, updateTransactionStatus } from "../../ledger/db";
import { jest } from "@jest/globals";

jest.mock("../client", () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

jest.mock("../../ledger/db", () => ({
  listPendingByStatus: jest.fn(),
  updateTransactionStatus: jest.fn(),
}));

describe("syncPendingEnvelopes", () => {
  beforeEach(() => {
    (apiClient.post as jest.Mock).mockClear();
    (listPendingByStatus as jest.Mock).mockClear();
    (updateTransactionStatus as jest.Mock).mockClear();
  });

  it("returns 0/0 when there are no pending envelopes", async () => {
    (listPendingByStatus as jest.Mock).mockReturnValue([]);

    const result = await syncPendingEnvelopes();

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(listPendingByStatus).toHaveBeenCalledWith("pending_reconciliation", "incoming");
  });

  it("batches in groups of 50", async () => {
    const pending = Array.from({ length: 120 }).map((_, i) => ({
      id: `tx_${i}`,
      envelopeJson: JSON.stringify({ transactionId: `tx_${i}` }),
    }));

    (listPendingByStatus as jest.Mock).mockReturnValue(pending);
    (apiClient.post as jest.Mock<any>).mockResolvedValue({
      data: pending.map((p) => ({ transactionId: p.id, status: "success" })),
    });

    await syncPendingEnvelopes();

    expect(apiClient.post).toHaveBeenCalledTimes(3);
    const calls = (apiClient.post as jest.Mock).mock.calls;
    expect((calls[0]![1] as any).envelopes).toHaveLength(50);
    expect((calls[1]![1] as any).envelopes).toHaveLength(50);
    expect((calls[2]![1] as any).envelopes).toHaveLength(20);
  });

  it("updates accepted to reconciled and rejected to rejected", async () => {
    const pending = [
      { id: "tx_1", envelopeJson: JSON.stringify({ transactionId: "tx_1" }) },
      { id: "tx_2", envelopeJson: JSON.stringify({ transactionId: "tx_2" }) },
    ];

    (listPendingByStatus as jest.Mock).mockReturnValue(pending);
    (apiClient.post as jest.Mock<any>).mockResolvedValue({
      data: [
        { transactionId: "tx_1", status: "success" },
        { transactionId: "tx_2", status: "rejected", reason: "invalid sig" },
      ],
    });

    const result = await syncPendingEnvelopes();

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(updateTransactionStatus).toHaveBeenCalledTimes(2);
    expect(updateTransactionStatus).toHaveBeenCalledWith("tx_1", "reconciled");
    expect(updateTransactionStatus).toHaveBeenCalledWith("tx_2", "rejected");
  });

  it("stops and leaves remaining pending on network failure", async () => {
    const pending = Array.from({ length: 60 }).map((_, i) => ({
      id: `tx_${i}`,
      envelopeJson: JSON.stringify({ transactionId: `tx_${i}` }),
    }));

    (listPendingByStatus as jest.Mock).mockReturnValue(pending);

    // Fail on the first batch.
    (apiClient.post as jest.Mock<any>).mockRejectedValue(new NetworkError());

    const result = await syncPendingEnvelopes();

    expect(result).toEqual({ synced: 0, failed: 0, networkUnavailable: true });
    expect(apiClient.post).toHaveBeenCalledTimes(1); // the first batch
    expect(updateTransactionStatus).not.toHaveBeenCalled();
  });
});
