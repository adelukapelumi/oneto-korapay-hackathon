jest.mock("../../api/auth", () => ({
  fetchMe: jest.fn(),
}));

jest.mock("../../ledger/db", () => ({
  getLocalState: jest.fn(),
  setLocalState: jest.fn(),
  sumPendingOutgoingKobo: jest.fn(),
}));

import { fetchMe } from "../../api/auth";
import {
  getLocalState,
  setLocalState,
  sumPendingOutgoingKobo,
} from "../../ledger/db";
import { getSpendableBalanceSnapshot } from "../balance-snapshot";
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
  });

  it("uses a fresh server balance, saves it locally, and reports source server", async () => {
    (fetchMe as jest.Mock).mockResolvedValue(makeMe("150000"));
    (sumPendingOutgoingKobo as jest.Mock).mockReturnValue(20_000);

    await expect(getSpendableBalanceSnapshot()).resolves.toEqual({
      verifiedBalanceKobo: 150_000,
      pendingOutgoingKobo: 20_000,
      spendableBalanceKobo: 130_000,
      source: "server",
    });

    expect(setLocalState).toHaveBeenCalledWith("verified_balance_kobo", "150000");
    expect(setLocalState).toHaveBeenCalledWith("last_sync_at", expect.any(String));
    expect(getLocalState).not.toHaveBeenCalled();
  });

  it("falls back to the local SQLite balance when the server fetch fails", async () => {
    (fetchMe as jest.Mock).mockRejectedValue(new Error("offline"));
    (getLocalState as jest.Mock).mockReturnValue("90000");

    await expect(getSpendableBalanceSnapshot()).resolves.toEqual({
      verifiedBalanceKobo: 90_000,
      pendingOutgoingKobo: 0,
      spendableBalanceKobo: 90_000,
      source: "local",
    });
  });

  it("subtracts pending outgoing payments from spendable balance", async () => {
    (fetchMe as jest.Mock).mockRejectedValue(new Error("offline"));
    (getLocalState as jest.Mock).mockReturnValue("100000");
    (sumPendingOutgoingKobo as jest.Mock).mockReturnValue(35_000);

    const snapshot = await getSpendableBalanceSnapshot();

    expect(snapshot.verifiedBalanceKobo).toBe(100_000);
    expect(snapshot.pendingOutgoingKobo).toBe(35_000);
    expect(snapshot.spendableBalanceKobo).toBe(65_000);
  });

  it("throws a clear error when neither server nor local balance is available", async () => {
    (fetchMe as jest.Mock).mockRejectedValue(new Error("offline"));
    (getLocalState as jest.Mock).mockReturnValue(null);

    await expect(getSpendableBalanceSnapshot()).rejects.toThrow(
      "No verified balance available. Open the app online to sync your balance.",
    );
  });
});
