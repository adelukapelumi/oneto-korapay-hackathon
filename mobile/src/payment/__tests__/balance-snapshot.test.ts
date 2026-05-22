jest.mock("../../api/auth", () => ({
  fetchMe: jest.fn(),
}));

jest.mock("../../ledger/db", () => ({
  getLocalState: jest.fn(),
  listPendingByStatus: jest.fn(),
  setLocalState: jest.fn(),
  sumPendingOutgoingKobo: jest.fn(),
}));

jest.mock("../sync-outgoing", () => ({
  syncOutgoingPendingFromServerLedger: jest.fn().mockResolvedValue({
    markedReconciled: 0,
  }),
}));

import { fetchMe } from "../../api/auth";
import {
  getLocalState,
  listPendingByStatus,
  setLocalState,
  sumPendingOutgoingKobo,
} from "../../ledger/db";
import { getStudentBalanceProjection } from "../balance-snapshot";
import type { Me } from "../../api/auth";

function makeMe(verifiedBalanceKobo: string): Me {
  return {
    id: "u_0123456789abcdef",
    email: "student@cu.edu.ng",
    phone: null,
    role: "STUDENT",
    status: "ACTIVE",
    verifiedBalanceKobo,
    createdAt: "2026-05-01T10:00:00.000Z",
  };
}

describe("getSpendableBalanceSnapshot", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (sumPendingOutgoingKobo as jest.Mock).mockReturnValue(0);
    (listPendingByStatus as jest.Mock).mockReturnValue([]);
  });

  it("returns the full available balance when there are no pending outgoing payments", async () => {
    (fetchMe as jest.Mock).mockResolvedValue(makeMe("150000"));

    await expect(getStudentBalanceProjection()).resolves.toEqual({
      serverConfirmedBalanceKobo: 150_000,
      pendingOutgoingKobo: 0,
      availableBalanceKobo: 150_000,
      pendingOutgoingCount: 0,
      lastSyncedAt: expect.any(String),
      source: "server",
    });

    expect(setLocalState).toHaveBeenCalledWith("verified_balance_kobo", "150000");
    expect(setLocalState).toHaveBeenCalledWith("last_sync_at", expect.any(String));
    expect(getLocalState).toHaveBeenCalledWith("last_sync_at");
  });

  it("falls back to the local SQLite balance when the server fetch fails", async () => {
    (fetchMe as jest.Mock).mockRejectedValue(new Error("offline"));
    (getLocalState as jest.Mock).mockImplementation((key: string) => {
      if (key === "verified_balance_kobo") {
        return "90000";
      }
      if (key === "last_sync_at") {
        return "2026-05-01T10:00:00.000Z";
      }
      return null;
    });

    await expect(getStudentBalanceProjection()).resolves.toEqual({
      serverConfirmedBalanceKobo: 90_000,
      pendingOutgoingKobo: 0,
      availableBalanceKobo: 90_000,
      pendingOutgoingCount: 0,
      lastSyncedAt: "2026-05-01T10:00:00.000Z",
      source: "local",
    });
  });

  it("subtracts one pending outgoing QR from the available balance", async () => {
    (fetchMe as jest.Mock).mockResolvedValue(makeMe("500000"));
    (sumPendingOutgoingKobo as jest.Mock).mockReturnValue(150_000);
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_1", amountKobo: 150_000, direction: "outgoing" },
    ]);

    const snapshot = await getStudentBalanceProjection();

    expect(snapshot.serverConfirmedBalanceKobo).toBe(500_000);
    expect(snapshot.pendingOutgoingKobo).toBe(150_000);
    expect(snapshot.availableBalanceKobo).toBe(350_000);
    expect(snapshot.pendingOutgoingCount).toBe(1);
  });

  it("subtracts multiple pending outgoing payments from the available balance", async () => {
    (fetchMe as jest.Mock).mockResolvedValue(makeMe("500000"));
    (sumPendingOutgoingKobo as jest.Mock).mockReturnValue(200_000);
    (listPendingByStatus as jest.Mock).mockReturnValue([
      { id: "tx_1", amountKobo: 150_000, direction: "outgoing" },
      { id: "tx_2", amountKobo: 50_000, direction: "outgoing" },
    ]);

    const snapshot = await getStudentBalanceProjection();

    expect(snapshot.serverConfirmedBalanceKobo).toBe(500_000);
    expect(snapshot.pendingOutgoingKobo).toBe(200_000);
    expect(snapshot.availableBalanceKobo).toBe(300_000);
    expect(snapshot.pendingOutgoingCount).toBe(2);
  });

  it("throws a clear error when neither server nor local balance is available", async () => {
    (fetchMe as jest.Mock).mockRejectedValue(new Error("offline"));
    (getLocalState as jest.Mock).mockReturnValue(null);

    await expect(getStudentBalanceProjection()).rejects.toThrow(
      "No verified balance available. Open the app online to sync your balance.",
    );
  });
});
